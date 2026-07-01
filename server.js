import "dotenv/config";
import express from "express";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { tool } from "@langchain/core/tools";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ---------------------------------------------------------------------------
// Menu "database" — just an array for this demo.
// ---------------------------------------------------------------------------
const MENU = [
  { id: "pizza-margherita", name: "Margherita Pizza", category: "Pizza", price: 9.5, description: "Tomato, mozzarella, fresh basil." },
  { id: "pizza-pepperoni", name: "Pepperoni Pizza", category: "Pizza", price: 11.0, description: "Tomato, mozzarella, spicy pepperoni." },
  { id: "salad-caesar", name: "Caesar Salad", category: "Salad", price: 7.5, description: "Romaine, parmesan, croutons, caesar dressing." },
  { id: "burger-cheese", name: "Cheeseburger", category: "Burger", price: 8.75, description: "Beef patty, cheddar, lettuce, tomato, brioche bun." },
  { id: "burger-veggie", name: "Veggie Burger", category: "Burger", price: 8.25, description: "Plant-based patty, lettuce, tomato, brioche bun." },
  { id: "pasta-carbonara", name: "Spaghetti Carbonara", category: "Pasta", price: 10.5, description: "Egg, parmesan, guanciale, black pepper." },
  { id: "salmon-grilled", name: "Grilled Salmon", category: "Main", price: 14.0, description: "Grilled salmon fillet with seasonal vegetables." },
  { id: "side-fries", name: "French Fries", category: "Side", price: 3.5, description: "Crispy golden fries." },
  { id: "drink-coke", name: "Coke", category: "Drink", price: 2.0, description: "330ml can." },
  { id: "drink-lemonade", name: "Lemonade", category: "Drink", price: 2.5, description: "Freshly squeezed lemonade." },
  { id: "dessert-cake", name: "Chocolate Cake", category: "Dessert", price: 5.5, description: "Rich chocolate layer cake." },
  { id: "dessert-tiramisu", name: "Tiramisu", category: "Dessert", price: 6.0, description: "Classic Italian coffee-flavored dessert." },
];

// In-memory cart (single global, fine for a local demo — swap for a session store for multi-user).
let cart = { items: [], lastOrder: null };

// Per-request log of which tools fired, so the frontend can highlight things. Reset each request.
let toolLog = [];

function findMenuItem(query) {
  const q = String(query || "").trim().toLowerCase();
  return (
    MENU.find((m) => m.name.toLowerCase() === q) ||
    MENU.find((m) => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase()))
  );
}

function cartTotal() {
  return cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

function logTool(name, input, result) {
  toolLog.push({ tool: name, input, result });
  return result;
}

// ---------------------------------------------------------------------------
// LangChain tools. Each tool's `func` is the real logic that mutates the cart.
// Gemini decides *when* to call these based on the conversation; LangChain
// handles converting the schema into the function-calling format Gemini expects.
// ---------------------------------------------------------------------------
const searchMenuTool = tool(
  async ({ query }) => {
    const q = query.toLowerCase();
    const matches = MENU.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
    );
    const result = { matches: matches.length ? matches : MENU };
    return JSON.stringify(logTool("search_menu", { query }, result));
  },
  {
    name: "search_menu",
    description:
      "Search the restaurant menu by keyword (name, category, or description). Use this to find the correct item before adding it to the cart if the user's wording doesn't exactly match a menu item name.",
    schema: z.object({
      query: z.string().describe("Search keyword, e.g. 'pizza' or 'dessert'."),
    }),
  }
);

const addToCartTool = tool(
  async ({ item_name, quantity, customizations }) => {
    const item = findMenuItem(item_name);
    if (!item) {
      return JSON.stringify(
        logTool("add_to_cart", { item_name, quantity, customizations }, {
          success: false,
          error: `No menu item matching "${item_name}". Use search_menu to find valid items.`,
        })
      );
    }
    const qty = quantity ?? 1;
    const custom = customizations ?? [];
    const existing = cart.items.find(
      (i) => i.id === item.id && JSON.stringify(i.customizations) === JSON.stringify(custom)
    );
    if (existing) existing.quantity += qty;
    else cart.items.push({ id: item.id, name: item.name, price: item.price, quantity: qty, customizations: custom });

    const result = { success: true, cart, total: cartTotal().toFixed(2) };
    return JSON.stringify(logTool("add_to_cart", { item_name, quantity: qty, customizations: custom }, result));
  },
  {
    name: "add_to_cart",
    description: "Add an item to the customer's cart. If it's already in the cart, increases the quantity.",
    schema: z.object({
      item_name: z.string().describe("The menu item name, e.g. 'Margherita Pizza'."),
      quantity: z.number().int().optional().describe("How many to add. Defaults to 1."),
      customizations: z.array(z.string()).optional().describe("Optional customizations, e.g. ['no onions']."),
    }),
  }
);

const removeFromCartTool = tool(
  async ({ item_name }) => {
    const item = findMenuItem(item_name);
    if (!item) {
      return JSON.stringify(
        logTool("remove_from_cart", { item_name }, { success: false, error: `No menu item matching "${item_name}".` })
      );
    }
    const before = cart.items.length;
    cart.items = cart.items.filter((i) => i.id !== item.id);
    const result = { success: cart.items.length < before, cart, total: cartTotal().toFixed(2) };
    return JSON.stringify(logTool("remove_from_cart", { item_name }, result));
  },
  {
    name: "remove_from_cart",
    description: "Remove an item entirely from the cart.",
    schema: z.object({ item_name: z.string() }),
  }
);

const updateQuantityTool = tool(
  async ({ item_name, quantity }) => {
    const item = findMenuItem(item_name);
    if (!item) {
      return JSON.stringify(
        logTool("update_quantity", { item_name, quantity }, { success: false, error: `No menu item matching "${item_name}".` })
      );
    }
    const line = cart.items.find((i) => i.id === item.id);
    if (!line) {
      return JSON.stringify(
        logTool("update_quantity", { item_name, quantity }, {
          success: false,
          error: `"${item.name}" is not currently in the cart.`,
        })
      );
    }
    if (quantity <= 0) cart.items = cart.items.filter((i) => i.id !== item.id);
    else line.quantity = quantity;

    const result = { success: true, cart, total: cartTotal().toFixed(2) };
    return JSON.stringify(logTool("update_quantity", { item_name, quantity }, result));
  },
  {
    name: "update_quantity",
    description: "Set the exact quantity of an item already in the cart. Setting quantity to 0 removes it.",
    schema: z.object({ item_name: z.string(), quantity: z.number().int() }),
  }
);

const viewCartTool = tool(
  async () => {
    const result = { cart, total: cartTotal().toFixed(2) };
    return JSON.stringify(logTool("view_cart", {}, result));
  },
  {
    name: "view_cart",
    description: "Get the current contents and total of the cart.",
    schema: z.object({}),
  }
);

const clearCartTool = tool(
  async () => {
    cart.items = [];
    const result = { success: true, cart };
    return JSON.stringify(logTool("clear_cart", {}, result));
  },
  {
    name: "clear_cart",
    description: "Empty the entire cart.",
    schema: z.object({}),
  }
);

const placeOrderTool = tool(
  async () => {
    if (cart.items.length === 0) {
      return JSON.stringify(logTool("place_order", {}, { success: false, error: "Cart is empty, nothing to order." }));
    }
    const orderId = "ORD-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    cart.lastOrder = { orderId, items: cart.items, total: cartTotal().toFixed(2), placedAt: new Date().toISOString() };
    cart.items = [];
    return JSON.stringify(logTool("place_order", {}, { success: true, order: cart.lastOrder }));
  },
  {
    name: "place_order",
    description: "Finalize and place the order. Only call this after the customer has explicitly confirmed they want to check out.",
    schema: z.object({}),
  }
);

const tools = [searchMenuTool, addToCartTool, removeFromCartTool, updateQuantityTool, viewCartTool, clearCartTool, placeOrderTool];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// Gemini model via LangChain, with tools bound to it.
// ---------------------------------------------------------------------------
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.3,
});
const modelWithTools = model.bindTools(tools);

const SYSTEM_PROMPT = `You are a friendly ordering assistant for "Bistro Prompt", a restaurant whose entire website is controlled by chat.
You have tools to search the menu and to add/remove/update items in the customer's cart, view the cart, and place the order.

Rules:
- Never claim you changed the cart unless you actually called the relevant tool.
- If the user's wording doesn't clearly match a menu item, call search_menu first, then add_to_cart with the exact matched name.
- Before calling place_order, briefly confirm the order summary with the user in your text response UNLESS they already clearly confirmed (e.g. "yes place the order", "confirm", "checkout now").
- Keep replies short, warm, and conversational (1-3 sentences). Do not repeat the full cart contents in text if the UI will show it — just confirm briefly.
- The current menu is: ${MENU.map((m) => `${m.name} ($${m.price.toFixed(2)})`).join(", ")}.`;

// ---------------------------------------------------------------------------
// Chat endpoint: runs the LangChain tool-calling loop against Gemini.
// `history` from the client is a simple [{role: "human"|"ai", content}] array
// covering only the final text turns (tool exchanges stay server-side).
// ---------------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!process.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY.includes("your-gemini")) {
      return res.status(500).json({ error: "Server is missing GOOGLE_API_KEY. Add your free key from https://aistudio.google.com/app/apikey to .env and restart." });
    }

    toolLog = [];

    const historyMessages = history.map((h) =>
      h.role === "human" ? new HumanMessage(h.content) : new AIMessage(h.content)
    );
    let messages = [new SystemMessage(SYSTEM_PROMPT), ...historyMessages, new HumanMessage(message)];

    let finalText = "";

    // Agentic loop: keep calling Gemini until it stops requesting tools (max 6 iterations as a safety cap)
    for (let i = 0; i < 6; i++) {
      const response = await modelWithTools.invoke(messages);
      messages.push(response);

      const calls = response.tool_calls || [];
      if (calls.length === 0) {
        finalText = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
        break;
      }

      for (const call of calls) {
        const selectedTool = toolsByName[call.name];
        const toolMessage = selectedTool
          ? await selectedTool.invoke(call)
          : { role: "tool", tool_call_id: call.id, content: `Unknown tool ${call.name}` };
        messages.push(toolMessage);
      }
    }

    const newHistory = [...history, { role: "human", content: message }, { role: "ai", content: finalText }];

    res.json({ reply: finalText, cart, toolLog, history: newHistory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Something went wrong." });
  }
});

app.get("/api/menu", (req, res) => res.json(MENU));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bistro Prompt (LangChain + Gemini) running at http://localhost:${PORT}`));
