// Google AI Summarizer
// Uses Google's Gemini 1.5 Flash API

import { useState, useCallback } from "react";

export type GoogleAIStatus = "idle" | "ready" | "generating" | "error";

const GOOGLE_AI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent";

export function useGoogleAISummarizer(apiKey: string, sharedContext?: string) {
  const [status, setStatus] = useState<GoogleAIStatus>(apiKey ? "ready" : "idle");

  const summarizeStream = useCallback(
    async function* (text: string): AsyncGenerator<string> {
      if (!apiKey) {
        throw new Error("Google AI API key is required");
      }

      setStatus("generating");

      const userPrompt = sharedContext || "Summarize the following entries concisely.";
      const combinedContent = `# Task Description\n\n${userPrompt}\n\n---\n\n# Scrum Contents\n\n${text}`;

      try {
        const response = await fetch(`${GOOGLE_AI_API_URL}?key=${apiKey}&alt=sse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: combinedContent }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
            },
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Google AI API error: ${response.status} - ${error}`);
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
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            try {
              const json = JSON.parse(trimmed.slice(6));
              const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
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
