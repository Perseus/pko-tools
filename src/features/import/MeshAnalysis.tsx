import type { MeshAnalysisReport } from "@/types/import";

export function MeshAnalysisPanel({
  report,
}: {
  report: MeshAnalysisReport | null;
}) {
  if (!report) return null;

  const stats = [
    { label: "Vertices", value: report.vertex_count.toLocaleString() },
    { label: "Triangles", value: report.triangle_count.toLocaleString(), warn: report.triangle_count > 3000 },
    { label: "Materials", value: report.material_count },
    { label: "Subsets", value: report.subset_count, warn: report.subset_count > 16 },
    { label: "Bones", value: report.bone_count, warn: report.bone_count > 25 },
  ];

  const features = [
    { label: "Normals", has: report.has_normals },
    { label: "UVs", has: report.has_texcoords },
    { label: "Colors", has: report.has_vertex_colors },
    { label: "Skinning", has: report.has_skinning },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {stats.map(({ label, value, warn }) => (
          <div key={label} className="text-center p-2 rounded bg-muted/50">
            <p className={`text-lg font-mono ${warn ? "text-yellow-400" : ""}`}>
              {value}
            </p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 text-xs">
        {features.map(({ label, has }) => (
          <span
            key={label}
            className={has ? "text-green-400" : "text-muted-foreground"}
          >
            {has ? "✓" : "✗"} {label}
          </span>
        ))}
      </div>
    </div>
  );
}
