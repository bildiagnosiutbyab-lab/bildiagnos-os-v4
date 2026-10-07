import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set([
  "https://bildiagnosiutbyab-lab.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://bildiagnosiutbyab-lab.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function outputText(payload: any) {
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return json(req, 403, { error: "Origin not allowed" });

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json(req, 503, { error: "Vision service is not configured" });

  try {
    const body = await req.json();
    const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
    if (!/^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/i.test(imageDataUrl)) {
      return json(req, 400, { error: "A supported image is required" });
    }
    if (imageDataUrl.length > 14_000_000) return json(req, 413, { error: "Image is too large" });

    const plate = String(body?.plate || "").trim().toUpperCase();
    const prompt = [
      "Read the vehicle information visible in this screenshot/photo from an automotive catalog.",
      "Extract only what is actually visible. Do not guess missing values and do not infer data from the registration plate.",
      "The labels may be Swedish, Spanish, English, German, or mixed.",
      "Return JSON only with exactly these keys: make, model, modelYear, vin, engine, fuelType, description.",
      "Use empty strings for unknown values. modelYear must be a four-digit year string when visible.",
      "VIN/chassis must preserve the visible characters accurately. engine should contain engine name/code exactly as shown.",
      plate ? `The work order registration plate is ${plate}; use it only to identify the relevant row if the screenshot shows several vehicles.` : "",
    ].filter(Boolean).join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_VISION_MODEL") || "gpt-6-luna",
        store: false,
        max_output_tokens: 500,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl, detail: "high" },
          ],
        }],
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error("OpenAI vision error", response.status, payload?.error?.type || "unknown");
      return json(req, 502, { error: "No se pudo analizar la imagen con IA." });
    }

    const raw = outputText(payload).trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
    let vehicle;
    try {
      vehicle = JSON.parse(raw);
    } catch {
      console.error("Vision returned non-JSON output");
      return json(req, 502, { error: "La IA no devolvió una ficha de vehículo válida." });
    }

    const clean = {
      make: String(vehicle?.make || "").trim(),
      model: String(vehicle?.model || "").trim(),
      modelYear: String(vehicle?.modelYear || "").trim(),
      vin: String(vehicle?.vin || "").trim().toUpperCase(),
      engine: String(vehicle?.engine || "").trim(),
      fuelType: String(vehicle?.fuelType || "").trim(),
      description: String(vehicle?.description || "").trim(),
    };
    return json(req, 200, { vehicle: clean });
  } catch (error) {
    console.error("vehicle-image-reader failed", error instanceof Error ? error.message : "unknown");
    return json(req, 500, { error: "No se pudo procesar la imagen." });
  }
});
