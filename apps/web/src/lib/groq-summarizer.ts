// Groq Cloud Summarizer
// Uses Groq's OpenAI-compatible API with Llama 3.1 70B

import { useState, useCallback } from "react";

export type GroqStatus = "idle" | "ready" | "generating" | "error";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-70b-versatile";

export function useGroqSummarizer(apiKey: string, sharedContext?: string) {
  const [status, setStatus] = useState<GroqStatus>(apiKey ? "ready" : "idle");

  const summarizeStream = useCallback(
    async function* (text: string): AsyncGenerator<string> {
      if (!apiKey) {
        throw new Error("Groq API key is required");
      }

      setStatus("generating");

      const userPrompt = sharedContext || "Summarize the following entries concisely.";
      const combinedContent = `# Task Description\n\n${userPrompt}\n\n---\n\n# Scrum Contents\n\n${text}`;

      try {
        const response = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "user", content: combinedContent }],
            stream: true,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Groq API error: ${response.status} - ${error}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const json = JSON.parse(trimmed.slice(6));
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }

        setStatus("ready");
      } catch (error) {
        setStatus("error");
        throw error;
      }
    },
    [apiKey, sharedContext]
  );

  return {
    status,
    summarizeStream,
  };
}
