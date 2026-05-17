import { ImageResponse } from "next/og";
import { getProject } from "@/lib/projects";

export const runtime = "nodejs";
export const alt = "groundwork project";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Props {
  params: Promise<{ city: string; id: string }>;
}

export default async function Image({ params }: Props) {
  const { city, id } = await params;
  const project = await getProject(city, id);

  const title = project?.name ?? "groundwork";
  const subtitle = project
    ? [project.borough, project.cityName].filter(Boolean).join(", ")
    : "affordable housing across six U.S. cities";
  const units = project ? project.units.total.toLocaleString() : "";
  const construction = project?.constructionType ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0b0f14",
          color: "#e6edf3",
          padding: "72px 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 22,
            color: "#6dd0a4",
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: "#6dd0a4",
            }}
          />
          groundwork
        </div>

        <div
          style={{
            marginTop: 60,
            fontSize: 64,
            lineHeight: 1.1,
            fontWeight: 600,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>

        {subtitle ? (
          <div
            style={{
              marginTop: 16,
              fontSize: 28,
              color: "#9aa6b2",
            }}
          >
            {subtitle}
          </div>
        ) : null}

        <div style={{ flex: 1 }} />

        {project ? (
          <div style={{ display: "flex", gap: 64, alignItems: "flex-end" }}>
            <Stat label="Total units" value={units} />
            {construction ? <Stat label="Construction" value={construction} /> : null}
            {project.startDate ? (
              <Stat label="Started" value={project.startDate.slice(0, 7)} />
            ) : null}
          </div>
        ) : null}
      </div>
    ),
    size,
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: 18,
          color: "#6c7787",
          textTransform: "uppercase",
          letterSpacing: 3,
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 56, fontWeight: 600, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}
