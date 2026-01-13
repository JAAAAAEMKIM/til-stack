// Google AI Summarizer
// Uses Google's Gemini 2.0 Flash API (free tier available)

import { useState, useCallback, useEffect } from "react";

export type GoogleAIStatus = "idle" | "ready" | "generating" | "error";

const GOOGLE_AI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent";

export function useGoogleAISummarizer(apiKey: string, sharedContext?: string) {
  const [status, setStatus] = useState<GoogleAIStatus>(() => {
    const initial = apiKey ? "ready" : "idle";
    console.log("[GoogleAI] Initial status:", initial, "apiKey:", apiKey ? `${apiKey.slice(0, 8)}...` : "(empty)");
    return initial;
  });

  // Update status when apiKey changes (e.g., loaded from localStorage)
  useEffect(() => {
    console.log("[GoogleAI] useEffect - apiKey:", apiKey ? `${apiKey.slice(0, 8)}...` : "(empty)", "status:", status);
    if (apiKey && status === "idle") {
      console.log("[GoogleAI] Setting status to ready (apiKey loaded)");
      setStatus("ready");
    } else if (!apiKey && status === "ready") {
      console.log("[GoogleAI] Setting status to idle (apiKey removed)");
      setStatus("idle");
    }
  }, [apiKey, status]);

  const summarizeStream = useCallback(
    async function* (text: string): AsyncGenerator<string> {
      console.log("[GoogleAI] summarizeStream called, apiKey:", apiKey ? `${apiKey.slice(0, 8)}...` : "(empty)");
      if (!apiKey) {
        throw new Error("Google AI API key is required");
      }

      setStatus("generating");
      console.log("[GoogleAI] Status set to generating");

      const userPrompt = sharedContext || "Summarize the following entries concisely.";
      const combinedContent = `# Task Description\n\n${userPrompt}\n\n---\n\n# Scrum Contents\n\n${text}`;

      console.log("[GoogleAI] Request input:", { textLength: text.length, promptLength: combinedContent.length });

      try {
        console.log("[GoogleAI] Fetching from API...");
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
          const errorText = await response.text();
          console.error("[GoogleAI] API error:", response.status, errorText);

          // Parse error and provide user-friendly message
          if (response.status === 429) {
            throw new Error("API quota exceeded.");
          } else if (response.status === 400 || response.status === 403) {
            throw new Error("Invalid API key.");
          } else {
            throw new Error(`API error (${response.status}).`);
          }
        }

        console.log("[GoogleAI] Response OK, reading stream...");
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let totalOutput = "";

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
                totalOutput += content;
                yield content;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }

        console.log("[GoogleAI] Stream complete, total output length:", totalOutput.length);
        setStatus("ready");
        console.log("[GoogleAI] Status set to ready");
      } catch (error) {
        console.error("[GoogleAI] Error:", error);
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
