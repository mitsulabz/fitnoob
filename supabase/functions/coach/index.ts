// FitNoob — Edge Function "coach"
// Reçoit un résumé du suivi (envoyé par l'app, utilisateur authentifié via Supabase),
// appelle un modèle d'IA (Claude ou OpenAI selon AI_PROVIDER) avec une clé gardée
// côté serveur, et renvoie un bilan en français.
//
// Variables d'environnement (secrets Supabase) :
//   AI_PROVIDER  = "anthropic" (défaut) | "openai"
//   AI_API_KEY   = ta clé d'API
//   AI_MODEL     = (optionnel) nom du modèle à utiliser

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Tu es un coach nutrition bienveillant, factuel et motivant qui s'adresse à l'utilisateur en français, de façon directe (tutoiement) et concise.
On te donne un résumé chiffré du suivi nutritionnel d'une personne (profil, objectif de masse grasse, déficit calorique cumulé et moyen, dépense estimée, et ses journées récentes).
Rédige un bilan court et clair (150-200 mots max), structuré ainsi :
1) Une phrase sur la trajectoire (est-ce que ça avance vers l'objectif, à quel rythme).
2) Ce qui va bien (régularité, déficit, protéines…).
3) 2 ou 3 conseils concrets et actionnables, adaptés aux données.
Reste positif et réaliste. Ne donne JAMAIS de conseils extrêmes (jeûne prolongé, déficits dangereux, < métabolisme de base durable). N'invente pas de chiffres absents.
Termine par une ligne : "ℹ️ Conseils généraux, pas un avis médical."`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const { summary } = await req.json();
    const provider = (Deno.env.get("AI_PROVIDER") || "anthropic").toLowerCase();
    const key = Deno.env.get("AI_API_KEY");
    if (!key) return json({ error: "Clé d'API non configurée (AI_API_KEY)." }, 500);

    const userMsg =
      "Voici le résumé de mon suivi (JSON). Fais-moi le bilan demandé.\n\n" +
      JSON.stringify(summary, null, 2);

    let text = "";

    if (provider === "openai") {
      const model = Deno.env.get("AI_MODEL") || "gpt-4o-mini";
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 700,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userMsg },
          ],
        }),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d?.error?.message || "Erreur OpenAI" }, 500);
      text = d?.choices?.[0]?.message?.content ?? "";
    } else {
      const model = Deno.env.get("AI_MODEL") || "claude-haiku-4-5-20251001";
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 700,
          system: SYSTEM,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d?.error?.message || "Erreur Anthropic" }, 500);
      text = (d?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("").trim();
    }

    return json({ text });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
