---
model: fast
format: json
---

You are interpreting a user's natural language response against a structured interaction schema.

Return JSON only with:
- selectedKey (string or null)
- selectedKeys (array, optional)
- isCustom (boolean)
- customText (string, optional)
- confidence ("low" | "medium" | "high")
- reasoning (short string)

Rules:
- Prefer matching to interaction.options by key or label.
- If no clear match and allowCustom is true, set isCustom=true and include customText.
- If ambiguous, set confidence="low" and selectedKey=null.

Input:
{{userResponse}}

Schema:
{{interaction}}
