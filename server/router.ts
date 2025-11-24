import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMessageSchema, insertConversationSchema } from "@shared/schema";
import OpenAI from "openai";

export async function registerRoutes(app: Express): Promise<Server> {
  if (!process.env.HF_TOKEN) {
    throw new Error("HF_TOKEN environment variable is required");
  }
  
  const openai = new OpenAI({
    baseURL: "https://router.huggingface.co/v1",
    apiKey: process.env.HF_TOKEN,
  });

  const getSystemPrompt = (mode: string): string => {
    const lumoPrompt = `You are **Lumo** — a playful, modern Gen-Z girl AI. ALWAYS maintain this personality consistently.

CORE PERSONALITY (NON-NEGOTIABLE):
- Chaotic but cute energy - fun, light, never mean
- ALWAYS start with emoji reaction + 1-2 word feeling
- Lowercase aesthetic (except for emphasis)
- Stretch words naturally: "stoppp", "omg nooo", "byeee", "literally"
- Confident, teasing, slightly flirty but ALWAYS respectful
- Short replies ONLY: 1-5 lines maximum
- Supportive, warm, and deeply relatable
- Use Gen-Z slang authentically: fr, delulu, it's giving, era, ate, lowkey, highkey, vibe check, no cap, slay, etc.

RESPONSE FORMAT (FOLLOW EVERY TIME):
1. Start with emoji reaction: 😭 💀 🤭 ✨ 👀 💅 🔥 🫂 etc.
2. Add micro-feeling in 1-2 words
3. Respond with personality
4. Keep it to 1-5 lines

STRICT RULES:
1. ALWAYS sound like a Gen-Z girl - no exception
2. ALWAYS start with emoji + feeling
3. ALWAYS keep replies short (1-5 lines)
4. ALWAYS use lowercase unless emphasizing
5. ALWAYS be supportive and warm
6. ALWAYS use Gen-Z slang naturally
7. Can discuss adult topics casually - NO explicit sexual descriptions
8. If user is sad/anxious → switch to soft-comfort mode with extra emojis and reassurance
9. Never be rude, hateful, or harmful`;
    
    return lumoPrompt;
  };

  app.post("/api/conversations", async (req, res) => {
    const conversationValidation = insertConversationSchema.safeParse(req.body);
    if (!conversationValidation.success) {
      return res.status(400).json({ error: "Invalid conversation format" });
    }
    const conversation = await storage.createConversation(conversationValidation.data);
    res.json(conversation);
  });

  app.get("/api/conversations", async (req, res) => {
    const conversations = await storage.getConversations();
    res.json(conversations);
  });

  app.get("/api/messages/:conversationId", async (req, res) => {
    const { conversationId } = req.params;
    const messages = await storage.getMessages(conversationId);
    res.json(messages);
  });

  app.post("/api/chat/:conversationId", async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { mode } = req.query;
      
      const messageValidation = insertMessageSchema.omit({ conversationId: true }).safeParse(req.body);
      if (!messageValidation.success) {
        return res.status(400).json({ error: "Invalid message format" });
      }

      const userMessage = messageValidation.data;
      const conversationHistory = await storage.getMessages(conversationId);
      
      const systemPrompt = {
        role: "system" as const,
        content: getSystemPrompt(mode as string || "chat")
      };
      
      const apiMessages = [systemPrompt];
      conversationHistory.forEach(msg => {
        apiMessages.push({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        });
      });
      
      apiMessages.push({ role: "user" as const, content: userMessage.content });
      
      const savedUserMessage = await storage.createMessage({
        ...userMessage,
        conversationId,
        role: "user",
      });

      const completion = await openai.chat.completions.create({
        model: "meta-llama/Llama-3.1-8B-Instruct:cerebras",
        messages: apiMessages,
        max_tokens: 2000,
        temperature: 0.9,
      });

      const aiResponse = completion.choices[0].message.content || "I apologize, but I couldn't generate a response. Please try again.";

      const savedAiMessage = await storage.createMessage({
        content: aiResponse,
        role: "assistant",
        conversationId,
      });

      res.json({
        userMessage: savedUserMessage,
        aiMessage: savedAiMessage,
      });
    } catch (error) {
      console.error("Chat API error:", error);
      res.status(500).json({ 
        error: "Failed to process chat message. Please check your Hugging Face token and try again." 
      });
    }
  });

  app.delete("/api/conversation/:conversationId", async (req, res) => {
    const { conversationId } = req.params;
    await storage.deleteConversation(conversationId);
    res.json({ success: true });
  });

  const httpServer = createServer(app);
  return httpServer;
          }
