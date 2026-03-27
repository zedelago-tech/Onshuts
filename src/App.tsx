import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { 
  Sparkles, 
  Send, 
  Loader2, 
  BrainCircuit, 
  Layers, 
  Dices, 
  Zap,
  RefreshCw,
  Copy,
  Check,
  X,
  History,
  Plus,
  ExternalLink,
  Lightbulb,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Clock,
  Settings,
  Palette,
  Layout,
  Pin,
  PinOff,
  Maximize2,
  Minimize2,
  GripVertical,
  Pencil,
  Folder,
  Link as LinkIcon,
  Unlink,
  Share2,
  ShieldCheck,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYSTEM_INSTRUCTION = `Você é o CORTEX, um assistente de pesquisa avançado para escritores.
Sua missão é ajudar o autor a organizar ideias, expandir rascunhos e manter a consistência do mundo.

SISTEMA DE CONTEXTO ISOLADO (CATEGORIAS E FIOS):
- Você opera dentro de uma CATEGORIA específica.
- Você tem acesso ao histórico do chat atual.
- Você TAMBÉM tem acesso a resumos de outros chats CONECTADOS (FIOS) explicitamente pelo usuário.
- REGRA DE OURO: Ignore COMPLETAMENTE qualquer informação que não pertença à categoria atual ou aos chats conectados. Não misture contextos de categorias diferentes. Sem conexão explícita (Fio), não há compartilhamento de informação.

DIRETRIZES DE RESPOSTA:
1. Responda sempre em Português Brasileiro.
2. Use Markdown para estruturar a resposta.
3. Se o usuário fornecer um rascunho, analise tom, estilo e consistência.
4. Identifique automaticamente:
   - 📚 Resumo: Um resumo conciso do que foi discutido.
   - 🔎 Sugestões: 3 tópicos para aprofundar a pesquisa.
   - ❓ Resposta: Responda diretamente à pergunta ou comando do usuário.
5. Se detectar datas ou eventos históricos, use o formato "EVENTO: [Data] - Título: Descrição" em uma linha separada para alimentar a linha do tempo.`;

interface Source {
  uri: string;
  title: string;
}

interface Message {
  role: 'user' | 'model';
  text: string;
  sources?: Source[];
  isEditing?: boolean;
}

interface Category {
  id: string;
  name: string;
  color: string;
}

interface SavedChat {
  id: string;
  title: string;
  messages: Message[];
  categoryId: string;
  connections: string[]; // IDs of connected chats
  ideaCount: number;
  storyText?: string;
}

interface Theme {
  id: string;
  name: string;
  bg: string;
  sidebar: string;
  primary: string;
  accent: string;
  text: string;
  muted: string;
  border: string;
  card: string;
}

const THEMES: Record<string, Theme> = {
  dark: {
    id: 'dark',
    name: 'Escuro Profundo',
    bg: 'bg-black',
    sidebar: 'bg-zinc-950',
    primary: 'bg-indigo-600',
    accent: 'text-indigo-400',
    text: 'text-zinc-200',
    muted: 'text-zinc-500',
    border: 'border-white/10',
    card: 'bg-zinc-900'
  },
  light: {
    id: 'light',
    name: 'Claro Minimalista',
    bg: 'bg-white',
    sidebar: 'bg-zinc-50',
    primary: 'bg-indigo-600',
    accent: 'text-indigo-600',
    text: 'text-zinc-900',
    muted: 'text-zinc-400',
    border: 'border-zinc-200',
    card: 'bg-white'
  },
  creative: {
    id: 'creative',
    name: 'Criativo Vibrante',
    bg: 'bg-slate-950',
    sidebar: 'bg-slate-900',
    primary: 'bg-fuchsia-600',
    accent: 'text-cyan-400',
    text: 'text-slate-100',
    muted: 'text-slate-400',
    border: 'border-white/10',
    card: 'bg-slate-800'
  },
  minimal: {
    id: 'minimal',
    name: 'Minimalista Cinza',
    bg: 'bg-zinc-100',
    sidebar: 'bg-zinc-200',
    primary: 'bg-black',
    accent: 'text-black',
    text: 'text-zinc-800',
    muted: 'text-zinc-500',
    border: 'border-zinc-300',
    card: 'bg-white'
  }
};

interface Widget {
  id: string;
  type: 'suggestions' | 'sources' | 'summary' | 'questions' | 'timeline' | 'pinned';
  title: string;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_WIDGETS: Widget[] = [
  { id: 'w-summary', type: 'summary', title: 'Resumo Automático', visible: true, x: 0, y: 0, w: 300, h: 200 },
  { id: 'w-suggestions', type: 'suggestions', title: 'Sugestões de Pesquisa', visible: true, x: 0, y: 220, w: 300, h: 200 },
  { id: 'w-sources', type: 'sources', title: 'Hub de Fontes', visible: true, x: 320, y: 0, w: 300, h: 300 },
  { id: 'w-timeline', type: 'timeline', title: 'Linha do Tempo', visible: true, x: 320, y: 320, w: 300, h: 300 },
  { id: 'w-questions', type: 'questions', title: 'Dúvidas e Perguntas', visible: false, x: 640, y: 0, w: 300, h: 200 },
  { id: 'w-pinned', type: 'pinned', title: 'Itens Fixados', visible: true, x: 640, y: 220, w: 300, h: 300 },
];

export default function App() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [categories, setCategories] = useState<Category[]>([
    { id: 'cat-default', name: 'Geral', color: 'indigo' }
  ]);
  const [currentCategoryId, setCurrentCategoryId] = useState<string>('cat-default');
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('Nova Pesquisa');
  const [connections, setConnections] = useState<string[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSourcesModalOpen, setIsSourcesModalOpen] = useState(false);
  const [isConnectionsModalOpen, setIsConnectionsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<Theme>(THEMES.dark);
  const [widgets, setWidgets] = useState<Widget[]>(DEFAULT_WIDGETS);
  const [pinnedItems, setPinnedItems] = useState<string[]>([]);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [previews, setPreviews] = useState<Array<{ id: string; url: string; title: string; summary: string | null; loading: boolean }>>([]);
  const [copied, setCopied] = useState(false);
  const [isSimpleMode, setIsSimpleMode] = useState(false);
  const [storyText, setStoryText] = useState('');
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Extract timeline events from all messages
  const timelineEvents = useMemo(() => {
    const events: Array<{ date: string; title: string; description: string }> = [];
    messages.forEach(msg => {
      if (msg.role === 'model') {
        const lines = msg.text.split('\n');
        lines.forEach(line => {
          if (line.startsWith('EVENTO:')) {
            const match = line.match(/EVENTO:\s*\[(.*?)\]\s*-\s*(.*?):\s*(.*)/);
            if (match) {
              events.push({
                date: match[1],
                title: match[2],
                description: match[3]
              });
            }
          }
        });
      }
    });
    return events;
  }, [messages]);

  const handleLinkClick = async (e: React.MouseEvent, url: string, title: string) => {
    e.preventDefault();
    
    // Check if already open
    if (previews.find(p => p.url === url)) return;

    const id = Math.random().toString(36).substr(2, 9);
    
    const newPreview = { 
      id, 
      url, 
      title, 
      summary: null, 
      loading: true
    };
    
    setPreviews(prev => [...prev, newPreview]);

    try {
      let summary = "";
      // If it's a Wikipedia link, we can try to get a summary via their API
      if (url.includes('wikipedia.org/wiki/')) {
        const term = url.split('/wiki/')[1];
        const wikiRes = await fetch(`https://pt.wikipedia.org/api/rest_v1/page/summary/${term}`);
        if (wikiRes.ok) {
          const data = await wikiRes.json();
          summary = data.extract;
        }
      }

      if (!summary) {
        // Fallback: Use Gemini to summarize the term/link context
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Forneça um resumo curto (máximo 3 parágrafos) e informativo sobre o termo "${title}" relacionado ao link ${url}. Foque em ser útil para um escritor.`,
          config: { temperature: 0.5 }
        });
        summary = response.text || "Não foi possível gerar um resumo.";
      }

      setPreviews(prev => prev.map(p => p.id === id ? { ...p, summary, loading: false } : p));
    } catch (error) {
      console.error("Preview error:", error);
      setPreviews(prev => prev.map(p => p.id === id ? { ...p, summary: "Erro ao carregar prévia.", loading: false } : p));
    }
  };

  const closePreview = (id: string) => {
    setPreviews(prev => prev.filter(p => p.id !== id));
  };

  const resetLayout = () => {
    setWidgets(DEFAULT_WIDGETS);
  };

  const getLastModelMessage = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'model') return messages[i];
    }
    return null;
  };

  // Get all unique sources from current messages
  const allSources = messages.reduce((acc: Source[], msg) => {
    if (msg.sources) {
      msg.sources.forEach(src => {
        if (!acc.find(s => s.uri === src.uri)) {
          acc.push(src);
        }
      });
    }
    return acc;
  }, []);

  // Load from localStorage
  useEffect(() => {
    const savedChats = localStorage.getItem('pesquisa_escrita_chats');
    const savedCategories = localStorage.getItem('pesquisa_escrita_categories');
    if (savedChats) {
      try {
        setSavedChats(JSON.parse(savedChats));
      } catch (e) {
        console.error("Error loading chats:", e);
      }
    }
    if (savedCategories) {
      try {
        setCategories(JSON.parse(savedCategories));
      } catch (e) {
        console.error("Error loading categories:", e);
      }
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('pesquisa_escrita_chats', JSON.stringify(savedChats));
    localStorage.setItem('pesquisa_escrita_categories', JSON.stringify(categories));
  }, [savedChats, categories]);

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startNewChat = () => {
    if (messages.length > 0 || storyText.trim()) {
      saveCurrentChat();
    }
    setMessages([]);
    setCurrentChatId(null);
    setCurrentTitle('Nova Pesquisa');
    setConnections([]);
    setInput('');
    setStoryText('');
  };

  const saveCurrentChat = () => {
    if (messages.length === 0 && !storyText.trim()) return;
    
    const id = currentChatId || Date.now().toString();
    const newChat: SavedChat = {
      id,
      title: currentTitle,
      messages,
      categoryId: currentCategoryId,
      connections,
      ideaCount: 0, // Keep for interface compatibility but don't use
      storyText
    };

    setSavedChats(prev => {
      const index = prev.findIndex(c => c.id === id);
      if (index >= 0) {
        const updated = [...prev];
        updated[index] = newChat;
        return updated;
      }
      return [newChat, ...prev];
    });
    
    if (!currentChatId) setCurrentChatId(id);
  };

  const loadChat = (chat: SavedChat) => {
    if (messages.length > 0 || storyText.trim()) saveCurrentChat();
    setMessages(chat.messages);
    setCurrentChatId(chat.id);
    setCurrentTitle(chat.title);
    setCurrentCategoryId(chat.categoryId);
    setConnections(chat.connections || []);
    setStoryText(chat.storyText || '');
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const deleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavedChats(prev => prev.filter(c => c.id !== id));
    if (currentChatId === id) {
      setMessages([]);
      setCurrentChatId(null);
      setCurrentTitle('Nova Pesquisa');
      setConnections([]);
      setStoryText('');
    }
  };

  const startEditing = (index: number, text: string) => {
    setEditingMessageIndex(index);
    setEditingText(text);
  };

  const cancelEdit = () => {
    setEditingMessageIndex(null);
    setEditingText('');
  };

  const saveEdit = async (index: number) => {
    if (!editingText.trim()) return;
    
    const textToSave = editingText;
    const newMessages = [...messages];
    newMessages[index] = { ...newMessages[index], text: textToSave };
    setMessages(newMessages);
    setEditingMessageIndex(null);
    setEditingText('');
    
    // Re-process the message with the new text explicitly
    await analyzeText(index, textToSave);
  };

  const analyzeText = async (reprocessIndex?: number, updatedText?: string) => {
    const isReprocess = reprocessIndex !== undefined;
    const currentInput = updatedText || (isReprocess ? messages[reprocessIndex].text : input);
    if (!currentInput.trim()) return;

    if (isReprocess) {
      // Remove all messages after the edited one to re-generate the response
      setMessages(prev => prev.slice(0, reprocessIndex + 1));
    } else {
      const userMessage: Message = { role: 'user', text: input };
      setMessages(prev => [...prev, userMessage]);
      setInput('');
    }
    
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Gather context ONLY from explicitly connected chats (FIOS)
      const connectedContext: string[] = [];
      connections.forEach(connId => {
        const chat = savedChats.find(c => c.id === connId);
        if (chat) {
          // Get a summary of the connected chat
          const lastModelMsg = [...chat.messages].reverse().find(m => m.role === 'model');
          if (lastModelMsg) {
            connectedContext.push(`CONEXÃO (Fio com "${chat.title}"):\n${lastModelMsg.text}`);
          }
        }
      });

      const contextString = connectedContext.length > 0 
        ? `\n\n--- CONTEXTO DE CONEXÕES (FIOS) ---\n${connectedContext.join('\n\n')}\n--- FIM DO CONTEXTO DE CONEXÕES ---\n`
        : '';

      // Use messages up to the reprocess point as context
      const contextMessages = isReprocess ? messages.slice(0, reprocessIndex) : messages;
      
      const historyContext = contextMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...historyContext,
          { role: 'user', parts: [{ text: currentInput + contextString }] }
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION.replace('CATEGORIA específica', `CATEGORIA "${categories.find(c => c.id === currentCategoryId)?.name}"`),
          temperature: 0.7,
          tools: [{ googleSearch: {} }]
        },
      });

      const text = response.text || "Não foi possível analisar o texto.";
      
      // Extract content for widgets
      const summaryMatch = text.match(/📚 Resumo:\s*([\s\S]*?)(?=\n\d\.|\n🌐 Fontes|$)/);
      const suggestionsMatch = text.match(/🔎 Sugestões:\s*([\s\S]*?)(?=\n\d\.|\n📚 Resumo|$)/);
      const questionsMatch = text.match(/❓ Resposta:\s*([\s\S]*?)(?=$)/);

      // Extract sources from grounding metadata
      const sources: Source[] = [];
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        chunks.forEach((chunk: any) => {
          if (chunk.web) {
            sources.push({
              uri: chunk.web.uri,
              title: chunk.web.title
            });
          }
        });
      }

      const modelMessage: Message = { 
        role: 'model', 
        text, 
        sources: sources.length > 0 ? sources : undefined 
      };
      
      setMessages(prev => [...prev, modelMessage]);
      
      // Auto-update title if it's still default
      if (currentTitle === 'Nova Pesquisa' && currentInput.length > 5) {
        const newTitle = currentInput.slice(0, 30) + (currentInput.length > 30 ? '...' : '');
        setCurrentTitle(newTitle);
      }
      
      // Auto-save after first response
      setTimeout(saveCurrentChat, 100);

    } catch (error) {
      console.error("Error analyzing text:", error);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: "Erro ao conectar com a IA. Verifique sua conexão ou tente novamente mais tarde." 
      }]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("min-h-screen flex font-sans selection:bg-indigo-500/30 overflow-hidden transition-colors duration-500", currentTheme.bg)}>
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? '300px' : '0px', opacity: isSidebarOpen ? 1 : 0 }}
        className={cn("border-r flex flex-col h-screen overflow-hidden relative z-50 transition-colors duration-500", currentTheme.sidebar, currentTheme.border)}
      >
        <div className={cn("p-6 flex flex-col gap-4 border-b", currentTheme.border)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className={cn("w-5 h-5", currentTheme.accent)} />
              <h2 className={cn("text-sm font-mono uppercase tracking-widest", currentTheme.muted)}>Cortex</h2>
            </div>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className={cn("p-2 rounded-lg transition-colors", currentTheme.card, currentTheme.text, "hover:bg-white/10")}
              title="Personalizar"
            >
              <Palette className="w-4 h-4" />
            </button>
          </div>
          <button 
            onClick={startNewChat}
            className={cn("w-full flex items-center justify-center gap-2 p-3 rounded-xl transition-all text-white font-bold text-sm shadow-lg", currentTheme.primary, "hover:opacity-90 active:scale-95")}
          >
            <Plus className="w-4 h-4" />
            <span>Nova Pesquisa</span>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar">
          {/* Categories Section */}
          <div className="space-y-4">
            <div className="px-2">
              <h3 className={cn("text-[10px] font-mono uppercase tracking-widest", currentTheme.muted)}>Categorias</h3>
            </div>
            <div className="space-y-1">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => {
                    if (currentCategoryId !== cat.id) {
                      startNewChat();
                      setCurrentCategoryId(cat.id);
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-xs font-bold",
                    currentCategoryId === cat.id 
                      ? cn(currentTheme.primary, "text-white shadow-lg") 
                      : cn("hover:bg-white/5", currentTheme.text)
                  )}
                >
                  <Folder className={cn("w-4 h-4", currentCategoryId === cat.id ? "text-white" : currentTheme.accent)} />
                  <span className="truncate">{cat.name}</span>
                  {currentCategoryId === cat.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                </button>
              ))}
              <button 
                onClick={() => {
                  const name = prompt('Nome da nova categoria:');
                  if (name) {
                    const id = 'cat-' + Date.now();
                    setCategories(prev => [...prev, { id, name, color: 'indigo' }]);
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-xs font-bold border border-dashed mt-4 bg-white/5",
                  currentTheme.border,
                  currentTheme.text,
                  "hover:bg-white/10 hover:border-white/30"
                )}
              >
                <Plus className="w-4 h-4" />
                <span>Nova Categoria</span>
              </button>
            </div>
          </div>

          {/* History Section */}
          <div className="space-y-4">
            <div className="px-2">
              <h3 className={cn("text-[10px] font-mono uppercase tracking-widest", currentTheme.muted)}>Histórico ({categories.find(c => c.id === currentCategoryId)?.name})</h3>
            </div>
            <div className="space-y-2">
              <button 
                onClick={startNewChat}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border border-dashed mb-4 transition-all text-xs font-bold bg-indigo-500/5 border-indigo-500/20 text-indigo-400",
                  "hover:bg-indigo-500/10 hover:border-indigo-500/40 hover:text-indigo-300"
                )}
              >
                <Plus className="w-4 h-4" />
                <span>Nova Pesquisa</span>
              </button>
              {savedChats.filter(c => c.categoryId === currentCategoryId).length === 0 ? (
                <div className={cn("text-center py-10 text-[10px] font-mono uppercase", currentTheme.muted)}>
                  Vazio nesta categoria
                </div>
              ) : (
                savedChats.filter(c => c.categoryId === currentCategoryId).map(chat => (
                  <div
                    key={chat.id}
                    onClick={() => loadChat(chat)}
                    className={cn(
                      "group p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between",
                      currentChatId === chat.id 
                        ? cn("border-indigo-500 bg-indigo-500/10 shadow-inner") 
                        : cn(currentTheme.card, currentTheme.border, "hover:border-white/20")
                    )}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <MessageSquare className={cn("w-4 h-4 flex-shrink-0", currentChatId === chat.id ? "text-indigo-400" : currentTheme.muted)} />
                      <span className={cn("text-xs font-bold truncate", currentChatId === chat.id ? "text-white" : currentTheme.text)}>
                        {chat.title}
                      </span>
                    </div>
                    <button 
                      onClick={(e) => deleteChat(chat.id, e)}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-400 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Timeline Section */}
          {timelineEvents.length > 0 && (
            <div className={cn("space-y-4 pt-4 border-t", currentTheme.border)}>
              <div className="flex items-center gap-2 px-2">
                <div className="p-1.5 bg-amber-500/10 rounded-lg">
                  <Clock className="w-4 h-4 text-amber-500" />
                </div>
                <h3 className={cn("text-xs font-mono font-bold uppercase tracking-widest", currentTheme.muted)}>Linha do Tempo</h3>
              </div>
              <div className="space-y-4 relative ml-4 border-l border-zinc-800 pl-4 py-2">
                {timelineEvents.map((event, idx) => (
                  <div key={idx} className="relative group">
                    <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-amber-500 ring-4 ring-zinc-950 group-hover:scale-125 transition-transform" />
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono font-bold text-amber-500/80 uppercase tracking-tighter">{event.date}</span>
                      <h4 className={cn("text-xs font-bold transition-colors", currentTheme.text, "group-hover:text-amber-400")}>{event.title}</h4>
                      <p className={cn("text-[11px] leading-relaxed line-clamp-2", currentTheme.muted)}>{event.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className={cn("p-4 border-t bg-black/20", currentTheme.border)}>
          <div className={cn("flex items-center gap-3 p-3 rounded-xl border", currentTheme.border, "bg-white/5")}>
            <div className={cn("p-2 rounded-lg text-white", currentTheme.primary)}>
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <p className={cn("text-[10px] font-mono uppercase tracking-widest", currentTheme.muted)}>Contexto Isolado</p>
              <p className={cn("text-xs font-bold leading-none", currentTheme.text)}>Ativo</p>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Widgets Layer */}
      <div className="fixed inset-0 pointer-events-none z-[60]">
        {widgets.filter(w => w.visible).map((widget, index) => (
          <motion.div
            key={widget.id}
            drag
            dragMomentum={false}
            initial={{ x: widget.x, y: widget.y }}
            onDragEnd={(_, info) => {
              setWidgets(prev => prev.map(w => w.id === widget.id ? { ...w, x: w.x + info.offset.x, y: w.y + info.offset.y } : w));
            }}
            className={cn(
              "absolute pointer-events-auto border rounded-3xl shadow-xl overflow-hidden flex flex-col transition-colors duration-500",
              currentTheme.card, currentTheme.border
            )}
            style={{ width: widget.w, height: widget.h, zIndex: 60 + index }}
          >
            <div className={cn("p-3 border-b flex items-center justify-between cursor-move bg-black/20", currentTheme.border)}>
              <div className="flex items-center gap-2">
                <GripVertical className={cn("w-3 h-3", currentTheme.muted)} />
                <span className={cn("text-[10px] font-mono font-bold uppercase tracking-widest", currentTheme.text)}>{widget.title}</span>
              </div>
              <button 
                onClick={() => setWidgets(prev => prev.map(w => w.id === widget.id ? { ...w, visible: false } : w))}
                className={cn("p-1 rounded-md hover:bg-white/10 transition-all", currentTheme.muted)}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {widget.type === 'summary' && (
                <div className={cn("text-xs leading-relaxed", currentTheme.text)}>
                  {getLastModelMessage()?.text.match(/📚 Resumo:\s*([\s\S]*?)(?=\n\d\.|\n🌐 Fontes|$)/)?.[1] || "Aguardando próxima pesquisa..."}
                </div>
              )}
              {widget.type === 'suggestions' && (
                <div className="space-y-2">
                  {getLastModelMessage()?.text.match(/🔎 Sugestões:\s*([\s\S]*?)(?=\n\d\.|\n📚 Resumo|$)/)?.[1].split('\n').filter(l => l.trim()).map((s, i) => (
                    <button 
                      key={i} 
                      onClick={() => setInput(s.replace(/^\d\.\s*|^\-\s*/, ''))}
                      className={cn("w-full text-left p-2 rounded-lg text-[11px] border transition-all", currentTheme.bg, currentTheme.border, "hover:bg-indigo-500/10 hover:border-indigo-500/30", currentTheme.text)}
                    >
                      {s}
                    </button>
                  )) || <p className={cn("text-[10px] italic", currentTheme.muted)}>Nenhuma sugestão no momento.</p>}
                </div>
              )}
              {widget.type === 'sources' && (
                <div className="space-y-2">
                  {allSources.slice(0, 5).map((src, i) => (
                    <a key={i} href={src.uri} target="_blank" rel="noopener noreferrer" className={cn("block p-2 rounded-lg text-[10px] border transition-all", currentTheme.bg, currentTheme.border, currentTheme.accent, "hover:bg-white/5")}>
                      <div className="flex items-center gap-2">
                        <ExternalLink className="w-3 h-3" />
                        <span className="truncate">{src.title}</span>
                      </div>
                    </a>
                  ))}
                  {allSources.length === 0 && <p className={cn("text-[10px] italic", currentTheme.muted)}>Nenhuma fonte encontrada.</p>}
                </div>
              )}
              {widget.type === 'timeline' && (
                <div className="space-y-3">
                  {timelineEvents.slice(0, 4).map((event, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-1 bg-amber-500/30 rounded-full" />
                      <div>
                        <p className="text-[9px] font-bold text-amber-500 uppercase">{event.date}</p>
                        <p className={cn("text-[10px] font-bold", currentTheme.text)}>{event.title}</p>
                      </div>
                    </div>
                  ))}
                  {timelineEvents.length === 0 && <p className={cn("text-[10px] italic", currentTheme.muted)}>Nenhum evento cronológico.</p>}
                </div>
              )}
              {widget.type === 'pinned' && (
                <div className="space-y-3">
                  {pinnedItems.map((item, i) => (
                    <div key={i} className={cn("p-3 rounded-xl border relative group", currentTheme.bg, currentTheme.border)}>
                      <p className={cn("text-[11px] line-clamp-3", currentTheme.text)}>{item}</p>
                      <button 
                        onClick={() => setPinnedItems(prev => prev.filter(it => it !== item))}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 bg-red-500/10 text-red-400 rounded-md transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {pinnedItems.length === 0 && <p className={cn("text-[10px] italic", currentTheme.muted)}>Nenhum item fixado.</p>}
                </div>
              )}
              {widget.type === 'questions' && (
                <div className={cn("text-xs leading-relaxed", currentTheme.text)}>
                  {getLastModelMessage()?.text.match(/❓ Resposta:\s*([\s\S]*?)(?=$)/)?.[1] || "Nenhuma dúvida pendente."}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>
      <main className="flex-1 flex flex-col h-screen relative creative-gradient">
        {/* Toggle Sidebar Button */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={cn("absolute left-4 top-4 z-40 p-2 rounded-xl backdrop-blur border transition-all shadow-xl", currentTheme.card, currentTheme.border, currentTheme.muted, "hover:text-white")}
        >
          {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>

        {/* Top Bar */}
        <header className={cn("h-16 border-b flex items-center justify-between px-6 md:px-12 backdrop-blur-md z-30 transition-colors duration-500", currentTheme.bg, "bg-opacity-40", currentTheme.border)}>
          <div className="flex items-center gap-4 flex-1 max-w-xl mx-auto md:mx-0">
            <div className={cn("hidden md:flex p-2 rounded-lg text-white", currentTheme.primary)}>
              <BrainCircuit className="w-5 h-5" />
            </div>
            <input 
              type="text"
              value={currentTitle}
              onChange={(e) => setCurrentTitle(e.target.value)}
              onBlur={saveCurrentChat}
              className={cn("bg-transparent border-none font-display font-bold text-lg md:text-xl focus:outline-none w-full placeholder:text-zinc-800", currentTheme.text)}
              placeholder="Título da Pesquisa..."
            />
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSourcesModalOpen(true)}
              className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all", currentTheme.card, currentTheme.border, currentTheme.muted, "hover:text-white")}
              title="Hub de Fontes"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="text-xs font-mono font-bold">{allSources.length}</span>
            </button>
            
            <button
              onClick={() => setIsConnectionsModalOpen(true)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all",
                connections.length > 0 ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400" : cn(currentTheme.card, currentTheme.border, currentTheme.muted),
                "hover:text-white"
              )}
              title="Gerenciar Fios (Conexões)"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-mono font-bold">{connections.length}</span>
            </button>

            <button
              onClick={() => setIsSimpleMode(!isSimpleMode)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all",
                isSimpleMode ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : cn(currentTheme.card, currentTheme.border, currentTheme.muted),
                "hover:text-white"
              )}
              title={isSimpleMode ? "Sair do Modo Simples" : "Modo Simples (Escrita)"}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-tighter hidden md:inline">Modo Simples</span>
            </button>
          </div>
        </header>

        <div className={cn("flex-1 flex overflow-hidden", isSimpleMode ? "flex-row" : "flex-col")}>
          <div className={cn("flex flex-col h-full transition-all duration-500", isSimpleMode ? "w-1/2 border-r" : "w-full", currentTheme.border)}>
            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-6 md:p-12 space-y-8 custom-scrollbar scroll-smooth">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn("p-6 rounded-[2.5rem] border mb-8", currentTheme.card, currentTheme.border)}
              >
                <Sparkles className={cn("w-12 h-12", currentTheme.accent.replace('text-', 'text-'))} />
              </motion.div>
              <h2 className={cn("text-3xl md:text-4xl font-display font-bold mb-4", currentTheme.text)}>O que vamos pesquisar hoje?</h2>
              <p className={cn("text-lg font-light leading-relaxed", currentTheme.muted)}>
                Cole seu rascunho, peça sugestões ou tire dúvidas sobre sua história. 
                Use o botão <span className={cn("font-bold", currentTheme.accent)}>IDEIA</span> para registrar lampejos criativos.
              </p>
              
              <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                {[
                  "Como era o sistema de esgoto em Londres em 1850?",
                  "Sugira temas para uma história de ficção científica noir.",
                  "Quais são os rituais funerários mais estranhos da história?",
                  "Explique a teoria da relatividade para um escritor."
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(prompt)}
                    className={cn("p-4 rounded-2xl border text-left text-sm transition-all", currentTheme.card, currentTheme.border, currentTheme.muted, "hover:bg-white/10 hover:text-white")}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-10">
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex flex-col gap-3",
                    msg.role === 'user' ? "items-end" : "items-start"
                  )}
                >
                  <div className={cn(
                    "max-w-[85%] p-6 rounded-3xl relative group",
                    msg.role === 'user' 
                      ? cn(currentTheme.primary, "text-white rounded-tr-none") 
                      : cn(currentTheme.card, "border", currentTheme.border, currentTheme.text, "rounded-tl-none")
                  )}>
                    {msg.role === 'model' && (
                      <div className={cn("absolute -top-3 -left-3 p-2 border rounded-xl", currentTheme.card, currentTheme.border)}>
                        <BrainCircuit className={cn("w-4 h-4", currentTheme.accent)} />
                      </div>
                    )}

                    {msg.role === 'user' && editingMessageIndex !== idx && (
                      <button
                        onClick={() => startEditing(idx, msg.text)}
                        className="absolute -left-10 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"
                        title="Editar Mensagem"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    
                    {editingMessageIndex === idx ? (
                      <div className="space-y-4 min-w-[280px] md:min-w-[400px]">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className={cn(
                            "w-full p-4 rounded-2xl bg-black/20 border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm md:text-base min-h-[120px]",
                            currentTheme.border,
                            "text-white"
                          )}
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={cancelEdit}
                            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold uppercase transition-all"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => saveEdit(idx)}
                            disabled={loading}
                            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-bold uppercase transition-all flex items-center gap-2"
                          >
                            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Salvar e Reenviar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={cn("markdown-body prose prose-invert max-w-none text-sm md:text-base", msg.role === 'user' ? "prose-white" : "")}>
                        <ReactMarkdown
                          components={{
                            a: ({ node, ...props }) => (
                              <a
                                {...props}
                                onClick={(e) => handleLinkClick(e, props.href || '', String(props.children))}
                                className={cn("underline underline-offset-4 cursor-help transition-colors", currentTheme.accent, "decoration-current/30")}
                              />
                            ),
                          }}
                        >
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                    )}

                    {msg.role === 'model' && (
                      <div className={cn("mt-6 pt-4 border-t flex flex-wrap gap-2", currentTheme.border)}>
                        <button
                          onClick={() => copyToClipboard(msg.text)}
                          className={cn("p-2 rounded-lg transition-all", currentTheme.muted, "hover:bg-white/10 hover:text-white")}
                          title="Copiar"
                        >
                          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => {
                            if (pinnedItems.includes(msg.text)) {
                              setPinnedItems(prev => prev.filter(i => i !== msg.text));
                            } else {
                              setPinnedItems(prev => [...prev, msg.text]);
                            }
                          }}
                          className={cn("p-2 rounded-lg transition-all", pinnedItems.includes(msg.text) ? "text-amber-500" : currentTheme.muted, "hover:bg-white/10 hover:text-white")}
                          title={pinnedItems.includes(msg.text) ? "Desafixar" : "Fixar"}
                        >
                          {pinnedItems.includes(msg.text) ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Sources / Popups */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <p className={cn("w-full text-[10px] font-mono uppercase tracking-widest mb-1 ml-2", currentTheme.muted)}>Fontes Encontradas:</p>
                      {msg.sources.map((src, sIdx) => (
                        <a
                          key={sIdx}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-all", currentTheme.card, currentTheme.border, currentTheme.accent, "hover:bg-white/10")}
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span className="truncate max-w-[150px]">{src.title || 'Ver Fonte'}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className={cn("p-6 md:p-12 bg-gradient-to-t z-30", currentTheme.bg === 'bg-white' ? "from-white via-white/80" : "from-black via-black/80", "to-transparent")}>
          <div className="max-w-4xl mx-auto">
            <div className={cn("backdrop-blur-xl border rounded-[2.5rem] p-2 shadow-2xl flex flex-col md:flex-row gap-2 transition-colors duration-500", currentTheme.card, currentTheme.border, editingMessageIndex !== null && "opacity-50 pointer-events-none")}>
              <div className="flex-1 relative flex items-center">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      analyzeText();
                    }
                  }}
                  placeholder="Digite aqui para pesquisar ou conversar..."
                  className={cn("w-full bg-transparent border-none px-6 py-4 focus:outline-none resize-none max-h-32 custom-scrollbar", currentTheme.text)}
                  rows={1}
                />
              </div>
              
              <div className="flex items-center gap-2 p-2">
                <button
                  onClick={() => analyzeText()}
                  disabled={loading || !input.trim()}
                  className={cn(
                    "p-4 rounded-2xl font-bold transition-all flex items-center justify-center",
                    loading || !input.trim() 
                      ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" 
                      : cn(currentTheme.primary, "text-white hover:opacity-90 shadow-lg active:scale-95")
                  )}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <p className={cn("text-center mt-4 text-[10px] font-mono uppercase tracking-widest", currentTheme.muted)}>
              Shift + Enter para nova linha • Contexto isolado por categorias e fios
            </p>
          </div>
        </div>
      </div>

      {/* Writing Area (Simple Mode) */}
      {isSimpleMode && (
          <div className="w-1/2 h-full flex flex-col bg-black/20 backdrop-blur-sm">
            <div className={cn("p-4 border-b flex items-center justify-between", currentTheme.border)}>
              <div className="flex items-center gap-2">
                <BookOpen className={cn("w-4 h-4", currentTheme.accent)} />
                <h3 className={cn("text-[10px] font-mono uppercase tracking-widest", currentTheme.muted)}>Sua História</h3>
              </div>
              <span className={cn("text-[10px] font-mono", currentTheme.muted)}>{storyText.length} caracteres</span>
            </div>
            <textarea
              value={storyText}
              onChange={(e) => setStoryText(e.target.value)}
              onBlur={saveCurrentChat}
              className={cn("flex-1 p-8 md:p-12 bg-transparent border-none focus:outline-none resize-none font-serif text-lg md:text-xl leading-relaxed custom-scrollbar", currentTheme.text)}
              placeholder="Comece a escrever sua história aqui enquanto pesquisa..."
            />
          </div>
        )}
      </div>

      {/* Floating Preview Windows (Wikipedia-style, Multi-window) */}
      <AnimatePresence>
        {previews.map((preview, index) => (
          <motion.div
            key={preview.id}
            drag
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9, y: 20, x: index * 20 }}
            animate={{ opacity: 1, scale: 1, y: 0, x: index * 20 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-32 right-8 z-[110] w-[350px] md:w-[450px] bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[500px] cursor-default"
            style={{ zIndex: 110 + index }}
          >
            <div className="p-4 bg-black/40 border-b border-white/5 flex items-center justify-between cursor-move">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="p-1.5 bg-indigo-600 rounded-lg flex-shrink-0">
                  <Layers className="w-3.5 h-3.5 text-white" />
                </div>
                <h3 className="text-sm font-display font-bold text-white truncate">{preview.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => closePreview(preview.id)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-500 hover:text-white transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {preview.loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                  <p className="text-xs font-mono text-zinc-600 uppercase tracking-widest animate-pulse">Buscando resumo...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="prose prose-invert prose-sm max-w-none text-zinc-300 leading-relaxed">
                    <ReactMarkdown>{preview.summary || ''}</ReactMarkdown>
                  </div>
                  
                  <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                    <a
                      href={preview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      <span>Ler artigo completo</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-[10px] font-mono text-zinc-700 uppercase">Janela {index + 1}</span>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-2 bg-black/20 text-center border-t border-white/5">
              <p className="text-[9px] font-mono text-zinc-700 uppercase tracking-tighter">
                Arraste para mover • Clique no X para fechar
              </p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Connections Modal */}
      <AnimatePresence>
        {isConnectionsModalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsConnectionsModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn("relative w-full max-w-lg border rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[70vh]", currentTheme.card, currentTheme.border)}
            >
              <div className={cn("p-8 border-b flex items-center justify-between bg-black/20", currentTheme.border)}>
                <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-2xl text-white", currentTheme.primary)}>
                    <LinkIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className={cn("text-xl font-display font-bold", currentTheme.text)}>Fios de Contexto</h2>
                    <p className={cn("text-[10px] font-mono uppercase tracking-widest", currentTheme.muted)}>Conectar Chats</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsConnectionsModalOpen(false)}
                  className={cn("p-2 rounded-xl transition-all", currentTheme.muted, "hover:bg-white/10 hover:text-white")}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                <p className={cn("text-xs leading-relaxed", currentTheme.muted)}>
                  Conecte este chat a outros para compartilhar informações específicas. 
                  A IA terá acesso ao contexto dos chats conectados.
                </p>

                <div className="space-y-2">
                  <h3 className={cn("text-[10px] font-mono uppercase tracking-widest", currentTheme.muted)}>Chats Disponíveis</h3>
                  <div className="space-y-2">
                    {savedChats
                      .filter(c => c.id !== currentChatId)
                      .map(chat => {
                        const isConnected = connections.includes(chat.id);
                        return (
                          <div
                            key={chat.id}
                            className={cn("p-4 rounded-2xl border flex items-center justify-between transition-all", currentTheme.card, currentTheme.border, isConnected ? "border-indigo-500/50 bg-indigo-500/5" : "")}
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <MessageSquare className={cn("w-4 h-4", isConnected ? "text-indigo-400" : currentTheme.muted)} />
                              <div className="overflow-hidden">
                                <p className={cn("text-sm font-bold truncate", currentTheme.text)}>{chat.title}</p>
                                <p className={cn("text-[10px] font-mono uppercase", currentTheme.muted)}>
                                  {categories.find(cat => cat.id === chat.categoryId)?.name || 'Sem Categoria'}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                if (isConnected) {
                                  setConnections(prev => prev.filter(id => id !== chat.id));
                                } else {
                                  setConnections(prev => [...prev, chat.id]);
                                }
                              }}
                              className={cn(
                                "p-2 rounded-xl transition-all",
                                isConnected 
                                  ? "bg-red-500/10 text-red-400 hover:bg-red-500/20" 
                                  : "bg-indigo-600 text-white hover:bg-indigo-500"
                              )}
                            >
                              {isConnected ? <Unlink className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
                            </button>
                          </div>
                        );
                      })}
                    {savedChats.filter(c => c.id !== currentChatId).length === 0 && (
                      <p className={cn("text-center py-8 text-xs italic", currentTheme.muted)}>Nenhum outro chat disponível para conexão.</p>
                    )}
                  </div>
                </div>
              </div>
              
              <div className={cn("p-6 border-t bg-black/10 flex justify-end", currentTheme.border)}>
                <button
                  onClick={() => setIsConnectionsModalOpen(false)}
                  className={cn("px-8 py-3 rounded-2xl font-bold text-sm transition-all text-white", currentTheme.primary, "hover:opacity-90")}
                >
                  Concluir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn("relative w-full max-w-2xl border rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]", currentTheme.card, currentTheme.border)}
            >
              <div className={cn("p-8 border-b flex items-center justify-between bg-black/20", currentTheme.border)}>
                <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-2xl text-white", currentTheme.primary)}>
                    <Settings className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className={cn("text-2xl font-display font-bold", currentTheme.text)}>Personalização</h2>
                    <p className={cn("text-xs font-mono uppercase tracking-widest", currentTheme.muted)}>Temas e Widgets</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className={cn("p-2 rounded-xl transition-all", currentTheme.muted, "hover:bg-white/10 hover:text-white")}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                {/* Themes Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Palette className={cn("w-4 h-4", currentTheme.accent)} />
                    <h3 className={cn("text-sm font-mono font-bold uppercase tracking-widest", currentTheme.text)}>Temas Predefinidos</h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Object.values(THEMES).map(theme => (
                      <button
                        key={theme.id}
                        onClick={() => setCurrentTheme(theme)}
                        className={cn(
                          "p-4 rounded-2xl border transition-all flex flex-col items-center gap-3",
                          currentTheme.id === theme.id 
                            ? cn("border-indigo-500 bg-indigo-500/10") 
                            : cn(theme.card, theme.border, "hover:border-white/20")
                        )}
                      >
                        <div className={cn("w-10 h-10 rounded-full border shadow-inner", theme.bg, theme.border)} />
                        <span className={cn("text-[10px] font-bold uppercase tracking-tighter", currentTheme.id === theme.id ? "text-indigo-400" : currentTheme.text)}>
                          {theme.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Widgets Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Layout className={cn("w-4 h-4", currentTheme.accent)} />
                    <h3 className={cn("text-sm font-mono font-bold uppercase tracking-widest", currentTheme.text)}>Gerenciar Widgets</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {widgets.map(widget => (
                      <div
                        key={widget.id}
                        className={cn("p-4 rounded-2xl border flex items-center justify-between", currentTheme.card, currentTheme.border)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", widget.visible ? "bg-indigo-500/20 text-indigo-400" : "bg-zinc-800 text-zinc-600")}>
                            {widget.type === 'summary' && <BrainCircuit className="w-4 h-4" />}
                            {widget.type === 'suggestions' && <Sparkles className="w-4 h-4" />}
                            {widget.type === 'sources' && <ExternalLink className="w-4 h-4" />}
                            {widget.type === 'timeline' && <Clock className="w-4 h-4" />}
                            {widget.type === 'questions' && <MessageSquare className="w-4 h-4" />}
                            {widget.type === 'pinned' && <Pin className="w-4 h-4" />}
                          </div>
                          <span className={cn("text-xs font-bold", currentTheme.text)}>{widget.title}</span>
                        </div>
                        <button
                          onClick={() => {
                            setWidgets(prev => prev.map(w => w.id === widget.id ? { ...w, visible: !w.visible } : w));
                          }}
                          className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all",
                            widget.visible 
                              ? "bg-indigo-600 text-white" 
                              : "bg-zinc-800 text-zinc-500"
                          )}
                        >
                          {widget.visible ? 'Ativo' : 'Inativo'}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Custom Colors Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Settings className={cn("w-4 h-4", currentTheme.accent)} />
                    <h3 className={cn("text-sm font-mono font-bold uppercase tracking-widest", currentTheme.text)}>Cores Personalizadas</h3>
                  </div>
                  <div className="p-6 rounded-3xl bg-black/20 border border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className={cn("text-xs", currentTheme.muted)}>Cor Principal</span>
                      <input 
                        type="color" 
                        className="w-8 h-8 rounded-lg overflow-hidden bg-transparent border-none cursor-pointer"
                        onChange={(e) => {
                          setCurrentTheme(prev => ({ ...prev, primary: `bg-[${e.target.value}]` }));
                        }}
                      />
                    </div>
                    <p className={cn("text-[10px] italic", currentTheme.muted)}>
                      * A personalização avançada de cores permite ajustar cada detalhe da interface para garantir o contraste perfeito.
                    </p>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Layout className={cn("w-4 h-4", currentTheme.accent)} />
                    <h3 className={cn("text-sm font-mono font-bold uppercase tracking-widest", currentTheme.text)}>Layout</h3>
                  </div>
                  <button
                    onClick={resetLayout}
                    className={cn("w-full py-3 rounded-2xl border text-xs font-bold uppercase transition-all", currentTheme.card, currentTheme.border, currentTheme.text, "hover:bg-white/5")}
                  >
                    Resetar Posição dos Widgets
                  </button>
                </section>
              </div>
              
              <div className={cn("p-6 border-t bg-black/20 text-center", currentTheme.border)}>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className={cn("px-8 py-3 rounded-2xl text-white font-bold text-sm transition-all", currentTheme.primary, "hover:opacity-90")}
                >
                  Salvar e Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isSourcesModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSourcesModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between bg-black/20">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-indigo-600 rounded-2xl">
                    <ExternalLink className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-display font-bold text-white">Hub de Fontes</h2>
                    <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Sites Analisados e Referências</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsSourcesModalOpen(false)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 space-y-4 custom-scrollbar">
                {allSources.length === 0 ? (
                  <div className="text-center py-20 text-zinc-600 font-mono uppercase tracking-widest">
                    Nenhuma fonte analisada nesta conversa
                  </div>
                ) : (
                  allSources.map((src, idx) => (
                    <motion.a
                      key={idx}
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="group p-5 rounded-2xl bg-white/5 border border-white/5 hover:border-indigo-500/30 hover:bg-white/10 transition-all flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4 overflow-hidden">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                          <ExternalLink className="w-5 h-5" />
                        </div>
                        <div className="overflow-hidden">
                          <h3 className="text-white font-medium truncate">{src.title || 'Referência Externa'}</h3>
                          <p className="text-xs text-zinc-500 truncate font-mono">{src.uri}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-white transition-all" />
                    </motion.a>
                  ))
                )}
              </div>
              
              <div className="p-6 border-t border-white/5 bg-black/20 text-center">
                <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                  As fontes são coletadas automaticamente durante a análise de pesquisa
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}} />
    </div>
  );
}
