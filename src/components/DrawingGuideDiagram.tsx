import { useId, type ReactNode } from "react";
import { t } from "../lib/i18n";
import type { DrawingGuideKind } from "./drawing-guide-content";

function ArrowLine({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const dx = Math.cos(angle) * 4;
  const dy = Math.sin(angle) * 4;
  return (
    <g className="guide-measure">
      <path d={`M${x1} ${y1} L${x2} ${y2}`} />
      <path
        d={`M${x1 + dx - dy / 2} ${y1 + dy + dx / 2} L${x1} ${y1} L${x1 + dx + dy / 2} ${y1 + dy - dx / 2}`}
      />
      <path
        d={`M${x2 - dx - dy / 2} ${y2 - dy + dx / 2} L${x2} ${y2} L${x2 - dx + dy / 2} ${y2 - dy - dx / 2}`}
      />
    </g>
  );
}

function HorizontalDimension({
  from,
  to,
  y,
  edgeY,
  label,
}: {
  from: number;
  to: number;
  y: number;
  edgeY: number;
  label: string;
}) {
  return (
    <g className="guide-measure">
      <path d={`M${from} ${edgeY} V${y + 5} M${to} ${edgeY} V${y + 5}`} />
      <ArrowLine x1={from} y1={y} x2={to} y2={y} />
      <text x={(from + to) / 2} y={y - 7} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function VerticalDimension({
  from,
  to,
  x,
  edgeX,
  label,
  right = false,
}: {
  from: number;
  to: number;
  x: number;
  edgeX: number;
  label: string;
  right?: boolean;
}) {
  return (
    <g className="guide-measure">
      <path d={`M${edgeX} ${from} H${x - 5} M${edgeX} ${to} H${x - 5}`} />
      <ArrowLine x1={x} y1={from} x2={x} y2={to} />
      <text
        x={x + (right ? 7 : -7)}
        y={(from + to) / 2 + 3}
        textAnchor={right ? "start" : "end"}
      >
        {label}
      </text>
    </g>
  );
}

function Center({ x, y, size = 15 }: { x: number; y: number; size?: number }) {
  return (
    <path
      className="guide-centerline"
      d={`M${x - size} ${y} H${x + size} M${x} ${y - size} V${y + size}`}
    />
  );
}

function Outline({ children }: { children: ReactNode }) {
  return <g className="guide-outline">{children}</g>;
}

function Shape({ kind }: { kind: DrawingGuideKind }) {
  switch (kind) {
    case "semicircular-top":
    case "semielliptical-top":
    case "concave-top":
      return <ArchedOutline kind={kind} />;
    case "beveled-corner":
    case "trapezoid":
    case "rounded-slot":
    case "u-notch":
      return <CommonGeometry kind={kind} />;
    case "rectangle":
      return (
        <>
          <Outline>
            <rect x={75} y={45} width={210} height={150} />
          </Outline>
          <HorizontalDimension
            from={75}
            to={285}
            y={222}
            edgeY={195}
            label={t("Width 140")}
          />
          <VerticalDimension from={45} to={195} x={51} edgeX={75} label="100" />
          <text x={180} y={126} textAnchor="middle">
            {t("Height 100")}
          </text>
        </>
      );
    case "rounded-corners":
      return (
        <>
          <Outline>
            <path d="M110 205 V60 A35 35 0 0 1 145 25 H215 A35 35 0 0 1 250 60 V205 Z" />
          </Outline>
          <Center x={145} y={60} size={8} />
          <ArrowLine x1={145} y1={60} x2={120.2513} y2={35.2513} />
          <text x={155} y={77}>
            R35
          </text>
          <HorizontalDimension
            from={110}
            to={250}
            y={228}
            edgeY={205}
            label="140"
          />
          <VerticalDimension
            from={25}
            to={205}
            x={84}
            edgeX={110}
            label="180"
          />
        </>
      );
    case "circular-hole":
      return (
        <>
          <Outline>
            <rect x={60} y={35} width={240} height={180} />
            <circle className="guide-accent" cx={180} cy={125} r={20} />
          </Outline>
          <Center x={180} y={125} size={30} />
          <ArrowLine x1={160} y1={125} x2={200} y2={125} />
          <text x={180} y={89} textAnchor="middle">
            Ø20
          </text>
          <text x={180} y={239} textAnchor="middle">
            {t("Diameter passes through the center")}
          </text>
        </>
      );
    case "triangular-notch":
      return (
        <>
          <Outline>
            <path d="M45 25 H185 V94 L182 95 L185 96 V205 H45 Z" />
            <path className="guide-accent" d="M185 94 L182 95 L185 96" />
            <path d="M240 75 H300 V110 L270 120 L300 130 V165 H240 Z" />
            <path className="guide-accent" d="M300 110 L270 120 L300 130" />
          </Outline>
          <circle className="guide-detail-ring" cx={185} cy={95} r={8} />
          <path className="guide-centerline" d="M193 95 L237 119 M185 95 H35" />
          <VerticalDimension from={25} to={95} x={28} edgeX={45} label="70" />
          <VerticalDimension
            from={110}
            to={130}
            x={320}
            edgeX={300}
            label="2"
            right
          />
          <HorizontalDimension
            from={270}
            to={300}
            y={188}
            edgeY={130}
            label="3"
          />
          <text x={270} y={59} textAnchor="middle">
            {t("Enlarged detail")}
          </text>
          <text x={270} y={211} textAnchor="middle">
            {t("Opening 2 · Depth 3")}
          </text>
          <text x={180} y={239} textAnchor="middle">
            {t("Measure to the opening center")}
          </text>
        </>
      );
    case "rectangular-notch":
      return (
        <>
          <Outline>
            <path d="M70 40 H270 V100 H240 V120 H270 V190 H70 Z" />
            <path className="guide-accent" d="M270 100 H240 V120 H270" />
          </Outline>
          <path className="guide-centerline" d="M60 110 H238" />
          <VerticalDimension from={40} to={110} x={47} edgeX={70} label="35" />
          <HorizontalDimension
            from={240}
            to={270}
            y={78}
            edgeY={100}
            label="15"
          />
          <VerticalDimension
            from={100}
            to={120}
            x={297}
            edgeX={270}
            label="10"
            right
          />
          <text x={180} y={225} textAnchor="middle">
            {t("Opening 10 · Depth 15")}
          </text>
        </>
      );
    default:
      return <Arrangement kind={kind} />;
  }
}

function ArchedOutline({ kind }: { kind: DrawingGuideKind }) {
  const concave = kind === "concave-top";
  const rise = kind === "semicircular-top" ? 5 : 3;
  const radiusY = rise * 18;
  const endpointY = concave ? 55 : 120;
  const bottomY = concave ? 199 : 192;
  const extremeY = endpointY + (concave ? radiusY : -radiusY);
  const arc = `M90 ${endpointY} A90 ${radiusY} 0 0 ${concave ? 0 : 1} 270 ${endpointY}`;
  return (
    <>
      <Outline>
        <path d={`${arc} V${bottomY} H90 Z`} />
        <path className="guide-accent" d={arc} />
      </Outline>
      <path className="guide-centerline" d={`M75 ${endpointY} H285`} />
      <HorizontalDimension
        from={90}
        to={270}
        y={225}
        edgeY={bottomY}
        label={t("Span 10")}
      />
      <VerticalDimension
        from={Math.min(extremeY, endpointY)}
        to={Math.max(extremeY, endpointY)}
        x={302}
        edgeX={180}
        label={t(concave ? "Depth {{value}}" : "Rise {{value}}", {
          value: rise,
        })}
        right
      />
      <VerticalDimension
        from={endpointY}
        to={bottomY}
        x={63}
        edgeX={90}
        label={concave ? "8" : "4"}
      />
      <text x={180} y={170} textAnchor="middle">
        {t(concave ? "Below the endpoint line" : "Straight side 4")}
      </text>
      <text x={180} y={17} textAnchor="middle">
        {t("Dashed line joins the endpoints")}
      </text>
    </>
  );
}

function CommonGeometry({ kind }: { kind: DrawingGuideKind }) {
  switch (kind) {
    case "beveled-corner":
      return (
        <>
          <Outline>
            <path d="M60 45 H280 L300 65 V205 H60 Z" />
            <path className="guide-accent" d="M280 45 L300 65" />
          </Outline>
          <path className="guide-centerline" d="M280 45 H300 V65" />
          <HorizontalDimension
            from={280}
            to={300}
            y={24}
            edgeY={45}
            label="10"
          />
          <VerticalDimension
            from={45}
            to={65}
            x={323}
            edgeX={300}
            label="10"
            right
          />
          <text x={180} y={126} textAnchor="middle">
            {t("Straight diagonal replaces the corner")}
          </text>
          <text x={180} y={235} textAnchor="middle">
            120 × 80
          </text>
        </>
      );
    case "trapezoid":
      return (
        <>
          <Outline>
            <path d="M120 45 H240 L270 195 H90 Z" />
            <path
              className="guide-accent"
              d="M120 45 L90 195 M240 45 L270 195"
            />
          </Outline>
          <path className="guide-centerline" d="M180 32 V208" />
          <HorizontalDimension
            from={120}
            to={240}
            y={25}
            edgeY={45}
            label="80"
          />
          <HorizontalDimension
            from={90}
            to={270}
            y={225}
            edgeY={195}
            label="120"
          />
          <VerticalDimension
            from={45}
            to={195}
            x={304}
            edgeX={270}
            label="100"
            right
          />
        </>
      );
    case "rounded-slot":
      return (
        <>
          <Outline>
            <rect x={60} y={45} width={240} height={160} />
            <rect
              className="guide-accent"
              x={140}
              y={109}
              width={80}
              height={32}
              rx={16}
            />
          </Outline>
          <path className="guide-centerline" d="M120 125 H240 M180 90 V160" />
          <HorizontalDimension
            from={140}
            to={220}
            y={183}
            edgeY={141}
            label="20"
          />
          <VerticalDimension
            from={109}
            to={141}
            x={248}
            edgeX={220}
            label="8"
            right
          />
          <text x={180} y={82} textAnchor="middle">
            {t("Semicircular ends · R4")}
          </text>
          <text x={180} y={235} textAnchor="middle">
            60 × 40
          </text>
        </>
      );
    case "u-notch":
      return (
        <>
          <Outline>
            <path d="M75 35 H270 V100 H230 A20 20 0 0 0 230 140 H270 V215 H75 Z" />
            <path
              className="guide-accent"
              d="M270 100 H230 A20 20 0 0 0 230 140 H270"
            />
          </Outline>
          <path className="guide-centerline" d="M200 120 H283" />
          <VerticalDimension
            from={100}
            to={140}
            x={300}
            edgeX={270}
            label="4"
            right
          />
          <HorizontalDimension
            from={210}
            to={270}
            y={177}
            edgeY={140}
            label="6"
          />
          <text x={155} y={113}>
            R2
          </text>
          <text x={180} y={239} textAnchor="middle">
            {t("Total depth includes the rounded end")}
          </text>
        </>
      );
    default:
      return null;
  }
}

function Arrangement({ kind }: { kind: DrawingGuideKind }) {
  switch (kind) {
    case "edge-offsets":
      return (
        <>
          <Outline>
            <rect x={60} y={30} width={240} height={180} />
            <circle className="guide-accent" cx={140} cy={90} r={8} />
          </Outline>
          <Center x={140} y={90} />
          <path className="guide-centerline" d="M60 90 H125 M140 30 V75" />
          <HorizontalDimension
            from={60}
            to={140}
            y={230}
            edgeY={90}
            label="40"
          />
          <VerticalDimension
            from={30}
            to={90}
            x={324}
            edgeX={140}
            label="30"
            right
          />
          <text x={190} y={124}>
            {t("Hole center")}
          </text>
        </>
      );
    case "centering":
      return (
        <>
          <Outline>
            <rect x={60} y={45} width={240} height={160} />
            <circle className="guide-accent" cx={180} cy={125} r={10} />
          </Outline>
          <path className="guide-centerline" d="M60 125 H300 M180 45 V205" />
          <HorizontalDimension
            from={60}
            to={180}
            y={228}
            edgeY={205}
            label="60"
          />
          <HorizontalDimension
            from={180}
            to={300}
            y={228}
            edgeY={205}
            label="60"
          />
          <VerticalDimension
            from={45}
            to={125}
            x={325}
            edgeX={300}
            label="40"
            right
          />
          <VerticalDimension
            from={125}
            to={205}
            x={325}
            edgeX={300}
            label="40"
            right
          />
          <text x={180} y={27} textAnchor="middle">
            {t("Equal distances on both sides")}
          </text>
        </>
      );
    case "symmetry":
      return (
        <>
          <Outline>
            <path d="M65 35 H295 V120 L280 125 L295 130 V215 H65 V130 L80 125 L65 120 Z" />
            <path
              className="guide-accent"
              d="M65 120 L80 125 L65 130 M295 120 L280 125 L295 130"
            />
          </Outline>
          <path className="guide-centerline" d="M180 22 V226 M80 125 H280" />
          <ArrowLine x1={80} y1={100} x2={180} y2={100} />
          <ArrowLine x1={180} y1={100} x2={280} y2={100} />
          <text x={180} y={239} textAnchor="middle">
            {t("One matching feature on each side")}
          </text>
        </>
      );
    case "hole-spacing":
      return (
        <>
          <Outline>
            <rect x={60} y={40} width={240} height={160} />
            <circle className="guide-accent" cx={130} cy={120} r={10} />
            <circle className="guide-accent" cx={230} cy={120} r={10} />
          </Outline>
          <Center x={130} y={120} />
          <Center x={230} y={120} />
          <path className="guide-centerline" d="M80 120 H280" />
          <HorizontalDimension
            from={130}
            to={230}
            y={226}
            edgeY={120}
            label="50"
          />
          <text x={180} y={24} textAnchor="middle">
            {t("Center to center")}
          </text>
          <text x={180} y={168} textAnchor="middle">
            2 × Ø10
          </text>
        </>
      );
    case "equal-spacing":
      return (
        <>
          <Outline>
            <rect x={40} y={50} width={280} height={140} />
            {[80, 180, 280].map((x) => (
              <circle className="guide-accent" key={x} cx={x} cy={120} r={8} />
            ))}
          </Outline>
          {[80, 180, 280].map((x) => (
            <Center key={x} x={x} y={120} />
          ))}
          <path className="guide-centerline" d="M40 120 H320" />
          <HorizontalDimension
            from={80}
            to={180}
            y={224}
            edgeY={120}
            label="50"
          />
          <HorizontalDimension
            from={180}
            to={280}
            y={224}
            edgeY={120}
            label="50"
          />
          <text x={180} y={31} textAnchor="middle">
            {t("3 holes · 2 equal intervals")}
          </text>
          <text x={180} y={163} textAnchor="middle">
            3 × Ø8
          </text>
        </>
      );
    default:
      return null;
  }
}

export default function DrawingGuideDiagram({
  kind,
  title,
}: {
  kind: DrawingGuideKind;
  title: string;
}) {
  const id = useId();
  return (
    <svg
      className="drawing-guide-diagram"
      viewBox="0 0 360 250"
      role="img"
      aria-labelledby={id}
    >
      <title id={id}>{t(title)}</title>
      <Shape kind={kind} />
    </svg>
  );
}
