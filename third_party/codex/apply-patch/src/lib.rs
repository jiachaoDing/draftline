// OpenAI Codex Apache-2.0; Draftline virtual-file/ABI wrapper.
mod parser;
mod streaming_parser;
mod seek_sequence;
mod text_file;
mod file_update;
use parser::{Hunk, ParseError, UpdateFileChunk};
use std::fmt;

#[derive(Debug, PartialEq)]
pub struct ApplyPatchArgs {
    pub patch: String,
    pub hunks: Vec<Hunk>,
    pub workdir: Option<String>,
    pub environment_id: Option<String>,
}
#[derive(Debug)]
pub enum ApplyPatchError { ComputeReplacements(String) }
impl fmt::Display for ApplyPatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self { Self::ComputeReplacements(message) => f.write_str(message) }
    }
}
impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPatchError(message) => write!(f, "invalid patch: {message}"),
            Self::InvalidHunkError { message, line_number } => write!(f, "invalid hunk at line {line_number}, {message}"),
        }
    }
}

// Policy preflight uses the original matcher. Upstream itself chooses the first
// match; Draftline requires a unique target and non-overlapping replacements.
fn unique_match(lines: &[String], pattern: &[String], start: usize, eof: bool) -> Result<Option<usize>, String> {
    let found = seek_sequence::seek_sequence(lines, pattern, start, eof);
    if let Some(index) = found {
        if !pattern.is_empty() && seek_sequence::seek_sequence(lines, pattern, index + 1, eof).is_some() {
            return Err("Ambiguous patch context. Read more surrounding lines and retry.".into());
        }
    }
    Ok(found)
}
pub fn apply_virtual(source: &str, patch: &str) -> Result<String, String> {
    let args = parser::parse_patch(patch).map_err(|e| e.to_string())?;
    if args.environment_id.is_some() { return Err("Environment IDs are not available for drawing.html.".into()); }
    let [Hunk::UpdateFile { path, move_path: None, chunks }] = args.hunks.as_slice() else {
        return Err("Only one Update File: drawing.html is permitted; add, delete and move are unavailable.".into());
    };
    if path.to_str() != Some("drawing.html") { return Err("Only the virtual file drawing.html is accessible.".into()); }
    let mut file = text_file::SourceFile::parse(source);
    let lines = file.line_texts();
    let mut cursor = 0;
    for chunk in chunks {
        if let Some(context) = &chunk.change_context {
            if let Some(index) = unique_match(&lines, std::slice::from_ref(context), cursor, false)? { cursor = index + 1; }
        }
        if chunk.old_lines.is_empty() { continue; }
        let mut pattern = chunk.old_lines.as_slice();
        let mut found = unique_match(&lines, pattern, cursor, chunk.is_end_of_file)?;
        if found.is_none() && pattern.last().is_some_and(String::is_empty) {
            pattern = &pattern[..pattern.len() - 1];
            found = unique_match(&lines, pattern, cursor, chunk.is_end_of_file)?;
        }
        if let Some(index) = found { cursor = index + pattern.len(); }
    }
    let replacements = file_update::compute_replacements(&lines, "drawing.html", chunks).map_err(|e| e.to_string())?;
    let mut end = 0;
    for (start, length, _) in &replacements {
        if *start < end { return Err("Overlapping patch chunks are not permitted.".into()); }
        end = start + length;
    }
    file.apply_replacements(&replacements);
    Ok(file.into_contents())
}

// Minimal UTF-8 ABI: caller owns all allocations; output starts with 0/1.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let bytes = vec![0u8; len].into_boxed_slice();
    Box::into_raw(bytes) as *mut u8
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len))); }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn apply(source: *const u8, source_len: usize, patch: *const u8, patch_len: usize) -> u64 {
    let source = unsafe { std::str::from_utf8(std::slice::from_raw_parts(source, source_len)).unwrap() };
    let patch = unsafe { std::str::from_utf8(std::slice::from_raw_parts(patch, patch_len)).unwrap() };
    let output = match apply_virtual(source, patch) { Ok(text) => format!("0{text}"), Err(error) => format!("1{error}") };
    let bytes = output.into_bytes().into_boxed_slice();
    let len = bytes.len() as u64;
    let ptr = Box::into_raw(bytes) as *mut u8 as u64;
    (len << 32) | ptr
}
