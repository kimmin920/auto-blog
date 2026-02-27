import { recoverUserSamples } from "../utils/recoverUserSamples.js";

export function normalizeStyleExamples(examples) {
    if (!examples) return { must_mimic: true, user_samples: [] };

    const result = { must_mimic: true, user_samples: [] };
    const samples = Array.isArray(examples?.user_samples)
        ? examples.user_samples
        : Array.isArray(examples)
            ? examples
            : [];

    result.user_samples = recoverUserSamples(samples).slice(0, 20);
    return result;
}

function toStringSafe(value) {
    return String(value ?? "").trim();
}

function toArraySafe(value) {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function outlineToText(outline) {
    if (!outline) return "";
    if (typeof outline === "string") return outline.trim();

    const normalized = normalizeOutline(outline);
    const lines = [];
    for (const section of normalized) {
        const bullets = Array.isArray(section?.bullets) ? section.bullets : [];
        lines.push(...bullets.map((b) => String(b).trim()).filter(Boolean));
    }
    return lines.join("\n").trim();
}

function pickDefined(entries) {
    const out = {};
    for (const [key, value] of entries) {
        if (value === undefined) continue;
        out[key] = value;
    }
    return Object.keys(out).length ? out : undefined;
}

function toOptionalString(value) {
    const text = toStringSafe(value);
    return text || undefined;
}

function toOptionalArray(value) {
    const arr = toArraySafe(value);
    return arr.length ? arr : undefined;
}

export function normalizeStructuredInfo(structuredInfo, legacyOutline) {
    const input = structuredInfo && typeof structuredInfo === "object" ? structuredInfo : {};
    const legacyNotes = outlineToText(legacyOutline);
    const visitContext = pickDefined([
        ["one_line_summary", toOptionalString(input?.visit_context?.one_line_summary)],
        ["who_with", toOptionalString(input?.visit_context?.who_with)],
        ["when", toOptionalString(input?.visit_context?.when)],
        ["mood", toOptionalString(input?.visit_context?.mood)],
        ["purpose", toOptionalString(input?.visit_context?.purpose)],
    ]);

    const locationInfo = pickDefined([
        ["area", toOptionalString(input?.location_info?.area)],
        ["parking", toOptionalString(input?.location_info?.parking)],
        ["accessibility", toOptionalString(input?.location_info?.accessibility)],
        ["nearby_spots", toOptionalString(input?.location_info?.nearby_spots)],
    ]);

    const menuInfo = pickDefined([
        ["main_menu", toOptionalString(input?.menu_info?.main_menu)],
        ["other_menu", toOptionalArray(input?.menu_info?.other_menu)],
        ["taste_points", toOptionalArray(input?.menu_info?.taste_points)],
        ["price_impression", toOptionalString(input?.menu_info?.price_impression)],
    ]);

    const serviceInfo = pickDefined([
        ["staff_attitude", toOptionalString(input?.service_info?.staff_attitude)],
        ["interior", toOptionalString(input?.service_info?.interior)],
        ["crowd_level", toOptionalString(input?.service_info?.crowd_level)],
        ["waiting", toOptionalString(input?.service_info?.waiting)],
    ]);

    const hospitalInfo = pickDefined([
        ["department", toOptionalString(input?.hospital_info?.department)],
        ["reason", toOptionalString(input?.hospital_info?.reason)],
        ["process", toOptionalString(input?.hospital_info?.process)],
        ["followup", toOptionalString(input?.hospital_info?.followup)],
    ]);

    const parentingInfo = pickDefined([
        ["child_stage", toOptionalString(input?.parenting_info?.child_stage)],
        ["situation", toOptionalString(input?.parenting_info?.situation)],
        ["reaction", toOptionalString(input?.parenting_info?.reaction)],
        ["tip", toOptionalString(input?.parenting_info?.tip)],
    ]);

    const generalInfo = pickDefined([
        ["key_points", toOptionalArray(input?.general_info?.key_points)],
        ["target_reader", toOptionalString(input?.general_info?.target_reader)],
        ["expected_outcome", toOptionalString(input?.general_info?.expected_outcome)],
        ["cost_impression", toOptionalString(input?.general_info?.cost_impression)],
        ["time_impression", toOptionalString(input?.general_info?.time_impression)],
        ["pros", toOptionalString(input?.general_info?.pros)],
        ["cons", toOptionalString(input?.general_info?.cons)],
        ["tip", toOptionalString(input?.general_info?.tip)],
        ["caution", toOptionalString(input?.general_info?.caution)],
    ]);

    const extraNotes = toOptionalString(input?.extra_notes) || toOptionalString(legacyNotes);

    return pickDefined([
        ["visit_context", visitContext],
        ["location_info", locationInfo],
        ["menu_info", menuInfo],
        ["service_info", serviceInfo],
        ["hospital_info", hospitalInfo],
        ["parenting_info", parentingInfo],
        ["general_info", generalInfo],
        ["extra_notes", extraNotes],
    ]) || {};
}

export function normalizeImagesMeta(imagesMeta, legacyImagesData) {
    const input = Array.isArray(imagesMeta) ? imagesMeta : [];
    const normalized = [];
    for (const img of input) {
        const rawType = toStringSafe(img?.type).toLowerCase();
        const rawSlot = toStringSafe(img?.slot).toUpperCase();
        const isVideo = rawType === "video" || rawSlot.startsWith("VIDEO_");
        if (isVideo) continue;

        const highlightsValue = Array.isArray(img?.highlights)
            ? img.highlights.map((v) => String(v ?? "").trim()).filter(Boolean).join(", ")
            : toStringSafe(img?.highlights);

        const subject = toStringSafe(img?.subject || img?.description || img?.caption);
        const highlight = toStringSafe(img?.highlight || highlightsValue || img?.description || img?.caption);
        const feeling = toStringSafe(img?.feeling || img?.mood);
        const url = toStringSafe(img?.url);

        if (!subject && !highlight && !feeling && !url) continue;

        normalized.push({
            slot: `PHOTO_${normalized.length + 1}`,
            subject: subject || `사진 ${normalized.length + 1}`,
            highlight,
            feeling,
            url,
        });
    }

    if (normalized.length > 0) return normalized;

    const legacy = Array.isArray(legacyImagesData) ? legacyImagesData : [];
    return legacy.map((img, idx) => {
        const caption = toStringSafe(img?.caption || img?.description);
        const lines = caption.split("\n").map((x) => x.trim()).filter(Boolean);
        return {
            slot: `PHOTO_${idx + 1}`,
            subject: lines[0] || `사진 ${idx + 1}`,
            highlight: lines.slice(1).join(" | ") || caption,
            feeling: "",
            url: toStringSafe(img?.url),
        };
    });
}

export function normalizeOutline(outline) {
    if (!outline) return [];

    let parsed = outline;
    if (typeof outline === "string") {
        try {
            if (outline.trim().startsWith("{") || outline.trim().startsWith("[")) {
                parsed = JSON.parse(outline);
            }
        } catch {
            // Keep as string if parsing fails
        }
    }

    // If it's a string (failed parse or was a plain string)
    if (typeof parsed === "string") {
        return [{
            id: "outline",
            intent: "outline_text",
            bullets: [parsed]
        }];
    }

    // If it's an array
    if (Array.isArray(parsed)) {
        return parsed.map((item, idx) => {
            if (typeof item === "string") {
                return { id: `section_${idx}`, intent: "outline_text", bullets: [item] };
            }
            const bullets = Array.isArray(item?.bullets)
                ? item.bullets.map((b) => String(b).trim()).filter(Boolean)
                : item?.bullets
                    ? [String(item.bullets)]
                    : [];
            const fallbackText = String(item?.outline_text || item?.text || "").trim();
            return {
                id: item?.id || `section_${idx}`,
                intent: item?.intent || "outline_text",
                bullets: bullets.length ? bullets : (fallbackText ? [fallbackText] : ["(내용 작성 필요)"])
            };
        });
    }

    // If it's an object
    if (typeof parsed === "object" && parsed !== null) {
        if (Array.isArray(parsed.outline_sections)) return normalizeOutline(parsed.outline_sections);
        if (Array.isArray(parsed.outline)) return normalizeOutline(parsed.outline);

        // Otherwise wrap it in an array structure
        return [{
            id: "outline",
            intent: "outline_text",
            bullets: [JSON.stringify(parsed)]
        }];
    }

    return [];
}
