export const errorsZhCN: Record<string, string> = {
  "The API key was rejected. Check your credentials.":
    "API 密钥被拒绝，请检查密钥。",
  "Your API key does not have access to this model.":
    "你的 API 密钥无权访问此模型。",
  "API endpoint or model not found. Check your Base URL and model.":
    "找不到接口或模型，请检查接口地址和模型名称。",
  "Provider rate limit or quota reached. Please try again later.":
    "已达到服务商的请求频率或额度上限，请稍后重试。",
  "The provider rejected the request. Check model compatibility and image support.":
    "服务商拒绝了请求，请检查模型兼容性及图片支持。",
  "The AI provider interrupted its stream. Please try again.":
    "模型服务商中断了流式回复，请重试。",
  "The AI provider is unavailable. Check your connection and try again.":
    "模型服务暂不可用，请检查网络后重试。",
  "The model connection was interrupted before completion. Please try again.":
    "模型连接在完成前中断，请重试。",
  "Unable to connect to the AI provider. Check your Base URL and network.":
    "无法连接模型服务商，请检查接口地址和网络。",
  "Use a public HTTPS API URL. Localhost HTTP is supported by the local development server.":
    "请使用公共 HTTPS 接口地址。本地开发服务器支持 localhost HTTP。",
  "The model returned invalid JSON. Try again or choose a model that supports structured instructions.":
    "模型返回的 JSON 无效，请重试或选择支持结构化指令的模型。",
  "The model returned an incomplete drawing response. Try again with a more capable model.":
    "模型返回的图纸回复不完整，请尝试更强的模型。",
  "The model declined this request. Adjust your instructions.":
    "模型拒绝了此请求，请调整指令。",
  "The model returned an unsupported tool call.":
    "模型返回了不支持的工具调用。",
  "The model returned an oversized tool call.": "模型返回的工具调用过大。",
  "The model returned invalid tool calls. Please try again.":
    "模型返回的工具调用无效，请重试。",
  "The model returned invalid tool call indices. Please try again.":
    "模型返回的工具调用序号无效，请重试。",
  "The model returned invalid request_user_input questions. Please try again.":
    "模型返回的追问格式无效，请重试。",
  "The model response is too large. Simplify the drawing and try again.":
    "模型回复过大，请简化图纸后重试。",
  "The model stopped sending data. Please try again.":
    "模型已停止发送数据，请重试。",
  "The provider ended a tool call before completion. Please try again.":
    "服务商在工具调用完成前结束了回复，请重试。",
  "The provider ended the stream before completion. Check streaming support and try again.":
    "服务商提前结束了流式回复，请检查流式支持后重试。",
  "The model response was cut off by its token limit. Please try again with a smaller drawing.":
    "模型回复因令牌上限被截断，请缩小图纸后重试。",
  "The model returned no content. Check model compatibility.":
    "模型未返回内容，请检查模型兼容性。",
  "The streaming connection was interrupted before completion. Please try again.":
    "流式连接在完成前中断，请重试。",
  "The streaming connection stopped sending data. Please try again.":
    "流式连接已停止发送数据，请重试。",
  "The server could not start the AI request.": "服务器无法启动 AI 请求。",
  "The server did not return a streaming response. Check your connection.":
    "服务器未返回流式回复，请检查连接。",
  "The server sent an invalid stream event. Please try again.":
    "服务器发送的流式事件无效，请重试。",
  "The server sent an invalid activity event. Please try again.":
    "服务器发送的操作事件无效，请重试。",
  "The server sent an invalid text chunk. Please try again.":
    "服务器发送的文本片段无效，请重试。",
  "The server returned an invalid completed response.":
    "服务器返回的完整回复无效。",
  "The server returned an invalid response. Please try again.":
    "服务器返回的回复无效，请重试。",
  "Request failed.": "请求失败。",
  "Cross-origin requests are not allowed.": "不允许跨来源请求。",
  "The image or drawing is too large.": "图片或图纸过大。",
  "Enter a model to test.": "请输入需要测试的模型。",
  "Choose a model in Model settings.": "请在模型设置中选择模型。",
  "Create a drawing before editing it.": "请先创建图纸，再进行编辑。",
  "Invalid request. Check your settings and input.":
    "请求无效，请检查设置和输入内容。",
  "The model did not produce valid SVG. Try again.":
    "模型未生成有效的 SVG，请重试。",
  "Drawing width and height must use explicit millimeter units.":
    "图纸宽高必须明确使用毫米单位。",
  "SVG scale must be exactly one coordinate unit per millimeter.":
    "SVG 必须严格使用每坐标单位一毫米的比例。",
  "Sheet information must use its own presentation group.":
    "图纸信息必须使用独立的 presentation 分组。",
  "The drawing needs separate geometry and dimension groups.":
    "图纸必须包含独立的几何和尺寸标注分组。",
  "All drawing elements must belong to a drawing layer.":
    "所有绘图元素必须归属图层。",
  "The drawing contains no vector geometry.": "图纸中没有矢量几何图形。",
  "Drawing element IDs must be unique and descriptive.":
    "图纸元素的 ID 必须唯一且具有描述性。",
  "Every geometry element needs an ID for selection.":
    "每个几何元素都需要用于选择的 ID。",
  "Each dimension needs a group ID and a data-for geometry reference.":
    "每个尺寸标注都需要分组 ID 和 data-for 几何引用。",
  "Dimension references must point to existing geometry.":
    "尺寸标注必须引用现有几何元素。",
  "Select a drawing element before applying a targeted edit.":
    "请先选择图纸元素，再进行局部修改。",
  "The edit must preserve element IDs and types.":
    "修改必须保留元素 ID 和类型。",
  "The edit removed a stable element ID. Try a whole-drawing edit.":
    "修改删除了稳定元素 ID，请尝试整图编辑。",
  "The edit removed a stable element ID.": "修改删除了稳定元素 ID。",
  "The selected element no longer exists.": "所选元素已不存在。",
  "The edit was not completed successfully. Your drawing is unchanged.":
    "修改未成功完成，图纸保持原样。",
  "The drawing or patch is too large.": "图纸或补丁过大。",
  "The patched source is too large.": "修改后的源代码过大。",
  "The model reused a tool call ID. Start a new request.":
    "模型重复使用了工具调用 ID，请发起新请求。",
  "The model reused a tool call ID. Your drawing is unchanged.":
    "模型重复使用了工具调用 ID，图纸保持原样。",
  "Source tools require an existing drawing.": "源代码工具需要已有图纸。",
  "The drawing reached its tool-round limit. Your drawing is unchanged; start a new request.":
    "已达到工具调用轮数上限，图纸保持原样，请发起新请求。",
  "The tool conversation is too large. Your drawing is unchanged.":
    "工具对话过大，图纸保持原样。",
  "Revision conflict: the drawing changed while questions were pending. Cancel questions and start a new request.":
    "版本冲突：等待回答期间图纸已变化，请取消追问并发起新请求。",
  "Revision conflict: the committed drawing changed. Start a new request.":
    "版本冲突：已保存的图纸发生变化，请发起新请求。",
  "The model returned a targeted edit without a selected element. Try again.":
    "未选择元素时模型返回了局部修改，请重试。",
  "The model tried to replace the whole drawing during a selected edit. Clear selection for a whole-drawing edit.":
    "局部编辑时模型尝试替换整张图纸。如需整图编辑，请先清除选择。",
  "This drawing has reached the clarification limit. Cancel questions and start a new instruction.":
    "已达到追问轮数上限，请取消追问并发送新指令。",
  "Text layout is unavailable in this browser.": "此浏览器无法进行文本排版。",
  "The sheet has invalid source bounds.": "图纸的原始边界无效。",
  "Source could not be formatted. You can still edit and apply it.":
    "源代码无法格式化，你仍可以编辑和应用代码。",
};
