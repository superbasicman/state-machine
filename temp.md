❯ gemini -p "say hi" -m gemini-2.5-flash-lite --output-format json                    

Server 'chrome-devtools' supports tool updates. Listening for changes...
{
  "session_id": "5b3e3f51-ecd8-4455-9ee1-c6838569cb3b",
  "response": "Hi!",
  "stats": {
    "models": {
      "gemini-2.5-flash-lite": {
        "api": {
          "totalRequests": 1,
          "totalErrors": 0,
          "totalLatencyMs": 2062
        },
        "tokens": {
          "input": 11300,
          "prompt": 11300,
          "candidates": 0,
          "total": 11376,
          "cached": 0,
          "thoughts": 76,
          "tool": 0
        }
      }
    },
    "tools": {
      "totalCalls": 0,
      "totalSuccess": 0,
      "totalFail": 0,
      "totalDurationMs": 0,
      "totalDecisions": {
        "accept": 0,
        "reject": 0,
        "modify": 0,
        "auto_accept": 0
      },
      "byName": {}
    },
    "files": {
      "totalLinesAdded": 0,
      "totalLinesRemoved": 0
    }
  }
}%

❯ codex -m gpt-5.1-codex-mini exec --json "say hi"
{"type":"thread.started","thread_id":"019b5cb3-76cc-7d83-a024-ed46b81a14a1"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Preparing simple response**"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hi!"}}
{"type":"turn.completed","usage":{"input_tokens":6672,"cached_input_tokens":3200,"output_tokens":8}}

claude -p --model claude-haiku-4-5-20251001 --output-format json "Say hi"
{"type":"result","subtype":"success","is_error":false,"duration_ms":2622,"duration_api_ms":2505,"num_turns":1,"result":"Hey! I'm Claude Code, ready to help you with your project. What would you like to work on?","session_id":"faae8329-a34e-4c53-a517-22c0c9f1515e","total_cost_usd":0.0116478,"usage":{"input_tokens":3,"cache_creation_input_tokens":8198,"cache_read_input_tokens":12673,"output_tokens":26,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":8198}},"modelUsage":{"claude-haiku-4-5-20251001":{"inputTokens":3,"outputTokens":26,"cacheReadInputTokens":12673,"cacheCreationInputTokens":8198,"webSearchRequests":0,"costUSD":0.0116478,"contextWindow":200000}},"permission_denials":[],"uuid":"0314a99d-a956-4d99-973c-00bca058c237"}