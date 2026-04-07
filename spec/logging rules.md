# 🧠 AI AGENT LOGGING RULES 

This is a **strict rulebook** your agent must follow.

---

# 1. 🎯 LOG DECISIONS, NOT THOUGHTS

### ❌ FORBIDDEN

* Raw chain-of-thought
* Token-by-token reasoning
* Verbose internal deliberation

### ✅ REQUIRED

Log:

* What the agent decided
* Why (short summary)
* What action it took

```json
{
  "event": "decision_made",
  "agent": "research_agent",
  "decision": "use_web_search",
  "reason": "user requested up-to-date information",
  "confidence": 0.92
}
```

---

# 2. 🧩 CORE EVENT TYPES (MANDATORY)

Your agent MUST log these event categories:

---

## 🟢 TASK LIFECYCLE

```json
{
  "event": "task_started",
  "task_id": "T-001",
  "goal": "summarize article"
}
```

```json
{
  "event": "task_completed",
  "status": "success",
  "duration_ms": 1200
}
```

---

## 🧠 DECISION EVENTS

```json
{
  "event": "decision_made",
  "decision": "call_tool",
  "tool": "web_search",
  "reason": "information requires freshness"
}
```

---

## 🔧 TOOL USAGE

```json
{
  "event": "tool_called",
  "tool": "web_search",
  "input_summary": "latest AI news",
  "status": "success",
  "duration_ms": 340
}
```

---

## ⚠️ ERROR EVENTS

```json
{
  "event": "error_occurred",
  "stage": "tool_execution",
  "error_type": "TimeoutError",
  "recovered": true
}
```

---

## 🔁 RETRY EVENTS

```json
{
  "event": "retry_attempt",
  "attempt": 2,
  "reason": "timeout"
}
```

---

## 📤 OUTPUT EVENTS

```json
{
  "event": "response_generated",
  "output_summary": "provided 5 key insights",
  "tokens_used": 820
}
```

---

# 3. 📦 STANDARD AGENT LOG FORMAT

Every log MUST include:

```json
{
  "timestamp": "ISO-8601",
  "level": "INFO | WARN | ERROR",
  "agent_id": "agent_001",
  "task_id": "T-001",
  "event": "event_name",
  "status": "success | failure",
  "message": "short summary",
  "metadata": {}
}
```

---

# 4. ⚡ PERFORMANCE RULES (CRITICAL)

AI agents generate massive logs → must control volume.

### Rules:

* Log **only meaningful transitions**
* Do NOT log every token or step
* Use **summaries instead of raw data**

---

## ✅ GOOD

```json
"input_summary": "user asked about climate change causes"
```

## ❌ BAD

```json
"input": "full 2000 token prompt..."
```

---

# 5. 🧠 CONTEXT-AWARE LOGGING

Logs must preserve **execution context**:

* task_id
* agent_id
* parent_task (for multi-agent systems)

---

# 6. 🔍 TRACEABILITY (VERY IMPORTANT)

You must be able to reconstruct:

👉 What happened step-by-step

WITHOUT:

* dumping full data
* logging everything

---

# 7. 🔐 PRIVACY & SAFETY RULES

NEVER log:

* Full user prompts (summarize instead)
* Sensitive data
* API keys
* Personal data

---

# 8. 🧪 OBSERVABILITY TRIAD

Your system must support:

### Logs → what happened

### Metrics → how often

### Traces → full flow

👉 Logs alone are NOT enough

---

# 9. 🧭 LOG LEVEL RULES

| Level | Usage                                |
| ----- | ------------------------------------ |
| INFO  | Decisions, tool calls, task progress |
| WARN  | Recoverable issues                   |
| ERROR | Failures                             |

👉 DEBUG = OFF in production

---

# 10. 🔁 MULTI-AGENT RULES

If multiple agents:

```json
{
  "event": "agent_handoff",
  "from_agent": "planner",
  "to_agent": "executor",
  "reason": "execution required"
}
```

---

# 11. 📊 COST TRACKING (IMPORTANT FOR AI)

Track usage:

```json
{
  "event": "llm_usage",
  "model": "gpt-5",
  "tokens_input": 500,
  "tokens_output": 300,
  "cost_estimate": 0.02
}
```

---

# 12. 🧠 FINAL GOLDEN RULES

1. Log **decisions, not thoughts**
2. Log **events, not noise**
3. Log **summaries, not raw data**
4. Log **failures always**
5. Every log must answer:

   * What happened?
   * Why?
   * What next?

---

# 🔥 AGENT DIRECTIVE (DROP-IN RULE)

```text
You MUST log all meaningful decisions, tool usage, and task lifecycle events.

You MUST NOT log raw chain-of-thought or full prompts.

All logs must be structured, concise, and include context (task_id, agent_id).

You MUST prioritize clarity, traceability, and low overhead.
```

---
