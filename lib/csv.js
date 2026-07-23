// -----------------------------------------------------------------------------
// lib/csv.js — Import/Export shared by Store Data, Devices, Gateways and the
// analytics tabs.
//
// Import is deliberately row-tolerant: one malformed row reports itself and the
// rest still land, because a 5000-row price file failing wholesale on a typo is
// how merchandising teams lose an afternoon.
// -----------------------------------------------------------------------------
import Papa from "papaparse";

/**
 * Serialise rows to CSV text.
 * @param rows    array of plain objects
 * @param columns [{ key, header, format? }] — also fixes column order
 */
export function toCsv(rows, columns) {
  const header = columns.map((c) => c.header ?? c.key);
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = c.format ? c.format(r[c.key], r) : r[c.key];
      if (v == null) return "";
      if (v instanceof Date) return v.toISOString();
      return typeof v === "object" ? JSON.stringify(v) : v;
    }),
  );
  // BOM so Excel opens UTF-8 (Arabic product names) correctly.
  return "﻿" + Papa.unparse({ fields: header, data: body });
}

/** A downloadable CSV Response. */
export function csvResponse(csv, filename) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Parse an uploaded CSV into typed rows.
 * @param text   raw file contents
 * @param schema Zod schema applied per row
 * @returns { rows, errors } — errors carry 1-based line numbers for the UI
 */
export function parseCsv(text, schema) {
  const parsed = Papa.parse(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const rows = [];
  const errors = [];

  for (const e of parsed.errors ?? []) {
    errors.push({ line: (e.row ?? 0) + 2, message: e.message });
  }

  parsed.data.forEach((raw, i) => {
    // Blank-string → undefined so Zod `.optional()` behaves as expected.
    const cleaned = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
    );
    const result = schema.safeParse(cleaned);
    if (result.success) {
      rows.push(result.data);
    } else {
      errors.push({
        line: i + 2, // +1 for the header row, +1 for 1-based counting
        message: result.error.issues
          .map((iss) => `${iss.path.join(".") || "row"}: ${iss.message}`)
          .join("; "),
      });
    }
  });

  return { rows, errors };
}

/** Read an uploaded file out of a multipart form. */
export async function fileFromRequest(req, field = "file") {
  const form = await req.formData();
  const file = form.get(field);
  if (!file || typeof file.text !== "function") return null;
  return { text: await file.text(), name: file.name ?? "upload.csv" };
}
