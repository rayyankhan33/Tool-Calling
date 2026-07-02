# Bistro Prompt — a restaurant ordered entirely by chat

A demo restaurant ordering website with **no buttons** — the entire experience (browsing the menu, adding/removing items, changing quantities, placing the order) is controlled through natural language, using **LangChain** + the **Gemini API** for tool calling.


<img width="1366" height="728" alt="image" src="https://github.com/user-attachments/assets/3bc41db4-ac64-45d7-a219-6bbd27d0565b" />




## How it works

Browser (chat UI) sends a prompt to the Express server's `/api/chat` endpoint. The server sends the conversation to the Gemini API via LangChain, along with a list of tools it's allowed to call. If Gemini responds with a `tool_calls` request instead of plain text, the server runs the matching JavaScript function (add_to_cart, place_order, etc.) against an in-memory cart, sends the result back to Gemini, and repeats until Gemini replies with plain text. That final reply and the updated cart are sent back to the browser.

`server.js` defines 7 tools (`search_menu`, `add_to_cart`, `remove_from_cart`, `update_quantity`, `view_cart`, `clear_cart`, `place_order`) using LangChain's `tool()` helper, and binds them to the Gemini model with `bindTools()`.

## Setup

1. Install dependencies

   npm install

2. Add your API key

   Copy `.env.example` to `.env`:

   copy .env.example .env

   Then open `.env` and paste in your free Gemini API key from https://aistudio.google.com/app/apikey

3. Run it

   node server.js

4. Open http://localhost:3000 and start typing orders, e.g.:
   - "I'd like a margherita pizza and a coke"
   - "actually make that two pizzas"
   - "what desserts do you have?"
   - "remove the coke, add a lemonade instead"
   - "that's everything, place my order"

## Project structure

llm-restaurant/
- server.js — Express server + tool definitions + LangChain/Gemini agent loop
- public/index.html — UI, styling, and chat logic (all inline)
- package.json
- .env.example — template, copy to .env and add your real key
- .gitignore — excludes .env and node_modules/

## Tech stack

- Express — serves the frontend and handles the /api/chat endpoint
- LangChain (@langchain/google-genai, @langchain/core) — wraps tool functions into a schema Gemini understands, and manages the tool-calling loop
- Gemini API (gemini-2.5-flash) — the model that decides when to call a tool vs. reply in plain text
- Zod — schema validation for tool inputs

## Notes

- The cart is stored in memory on the server (a single global object) — fine for a local demo, but would need a per-session store for multiple simultaneous users.
- The tool-calling loop is capped at 6 iterations per request as a safety limit against runaway calls.
