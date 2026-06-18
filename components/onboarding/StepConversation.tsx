"use client";
import { useEffect, useRef, useState } from "react";
import type { ConversationMessage, IntakeFormData } from "@/types/onboarding";

const COMPLETE_SIGNAL = "[CONVERSATION_COMPLETE]";

interface Props {
  intake: IntakeFormData;
  initialMessages: ConversationMessage[];
  onComplete: (messages: ConversationMessage[]) => void;
}

export default function StepConversation({
  intake,
  initialMessages,
  onComplete,
}: Props) {
  const [messages, setMessages] = useState<ConversationMessage[]>(initialMessages);
  const [userInput, setUserInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Send opening message on mount if no messages yet
  useEffect(() => {
    if (initialMessages.length === 0) {
      sendMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMessage(userText: string | null) {
    setError(null);
    const outgoing: ConversationMessage[] = userText
      ? [...messages, { role: "user", content: userText }]
      : messages;

    if (userText) {
      setMessages(outgoing);
      setUserInput("");
    }

    setIsStreaming(true);
    setStreamingText("");

    try {
      const res = await fetch("/api/onboarding/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake, messages: outgoing }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              accumulated += parsed.text;
              setStreamingText(accumulated);
            }
          } catch {
            // malformed chunk, skip
          }
        }
      }

      // Check for completion signal
      const hasComplete = accumulated.includes(COMPLETE_SIGNAL);
      const cleanedText = accumulated.replace(COMPLETE_SIGNAL, "").trim();

      const aiMessage: ConversationMessage = {
        role: "assistant",
        content: cleanedText,
      };
      const finalMessages = [...outgoing, aiMessage];
      setMessages(finalMessages);
      setStreamingText("");
      setIsStreaming(false);

      if (hasComplete) {
        setIsComplete(true);
      }

      // Focus input after AI responds
      if (!hasComplete) {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } catch (err) {
      setIsStreaming(false);
      setStreamingText("");
      setError("Something went wrong. Please try again.");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (userInput.trim() && !isStreaming) {
        sendMessage(userInput.trim());
      }
    }
  }

  function handleSkip() {
    onComplete(messages);
  }

  function handleSendSummary() {
    onComplete(messages);
  }

  return (
    <div className="ob-card ob-card--chat">
      <div className="ob-card__header">
        <p className="ob-eyebrow">Step 2 of 3</p>
        <h2 className="ob-heading">Discovery conversation</h2>
        <p className="ob-subtext">
          A few targeted questions to make your brief as accurate as possible.
        </p>
      </div>

      {/* Message thread */}
      <div className="ob-chat">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`ob-bubble ob-bubble--${msg.role}`}
          >
            {msg.role === "assistant" && (
              <div className="ob-bubble__avatar">
                <i className="ph-fill ph-sparkle" />
              </div>
            )}
            <div className="ob-bubble__body">
              <p className="ob-bubble__text">{msg.content}</p>
            </div>
          </div>
        ))}

        {/* Streaming bubble */}
        {isStreaming && (
          <div className="ob-bubble ob-bubble--assistant">
            <div className="ob-bubble__avatar">
              <i className="ph-fill ph-sparkle" />
            </div>
            <div className="ob-bubble__body">
              {streamingText ? (
                <p className="ob-bubble__text">{streamingText}<span className="ob-cursor" /></p>
              ) : (
                <div className="ob-typing">
                  <span /><span /><span />
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="ob-inline-error">
            <i className="ph ph-warning-circle" /> {error}
            <button onClick={() => sendMessage(null)} className="ob-link">
              Retry
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Complete CTA */}
      {isComplete && !isStreaming && (
        <div className="ob-chat-complete">
          <p className="ob-chat-complete__text">
            Great — I have everything I need. Ready to build your brief?
          </p>
          <button
            className="ob-btn ob-btn--primary"
            onClick={handleSendSummary}
          >
            Build My Brief
            <i className="ph-bold ph-arrow-right" />
          </button>
        </div>
      )}

      {/* Input area */}
      {!isComplete && (
        <div className="ob-chat-input">
          <textarea
            ref={inputRef}
            className="ob-chat-input__field"
            placeholder="Type your answer…"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={isStreaming}
          />
          <div className="ob-chat-input__actions">
            <button
              className="ob-btn ob-btn--ghost ob-btn--sm"
              type="button"
              onClick={handleSkip}
              disabled={isStreaming || messages.length < 2}
            >
              Skip to summary
            </button>
            <button
              className="ob-btn ob-btn--primary ob-btn--icon"
              type="button"
              disabled={!userInput.trim() || isStreaming}
              onClick={() => sendMessage(userInput.trim())}
              aria-label="Send"
            >
              <i className="ph-bold ph-paper-plane-tilt" />
            </button>
          </div>
          <p className="ob-chat-input__hint">
            Press Enter to send &middot; Shift+Enter for new line
          </p>
        </div>
      )}
    </div>
  );
}
