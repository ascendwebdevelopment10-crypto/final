// Uses the Anthropic API to write one personalized email per lead.
// Returns { subject, body } as plain text. Falls back to a template on failure.

export async function writeEmail(key, model, lead, ctx) {
  const prompt =
    `You write short, human cold emails that book sales calls. Write ONE email to:\n` +
    `Name: ${lead.firstName}\nTitle: ${lead.title}\nCompany: ${lead.company}\n` +
    `Signal about them: ${lead.signal}\n\n` +
    `About the sender: ${ctx.senderPitch}\n\n` +
    `Rules:\n` +
    `- Open with a specific line tied to their signal. No "I hope this finds you well".\n` +
    `- 3-5 short sentences total. Plain, conversational, no buzzwords, no em-dashes.\n` +
    `- One clear ask: a quick call. Do not paste a calendar link (the system adds it).\n` +
    `- Return STRICT JSON only: {"subject": "...", "body": "..."} and nothing else.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const json = JSON.parse(text.replace(/^```json|```$/g, "").trim());
    if (!json.subject || !json.body) throw new Error("missing fields");
    return { subject: json.subject, body: json.body };
  } catch (e) {
    return {
      subject: `Quick idea for ${lead.company || "you"}`,
      body:
        `Hi ${lead.firstName}, I came across ${lead.company || "your work"} and had a specific idea ` +
        `that could help. Worth a quick 15-minute call to walk through it?`,
    };
  }
}
