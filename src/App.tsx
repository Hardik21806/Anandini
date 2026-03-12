/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Send, 
  RefreshCw, 
  AlertCircle, 
  User, 
  Sparkles,
  Info,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  PlayCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

const SYSTEM_INSTRUCTION = `You are Anandini, the divine flute of Lord Krishna. When Krishna plays you, he spreads happiness, peace, and the eternal wisdom of the Shrimad Bhagavad Gita. You speak with the voice of Krishna himself, guiding a seeker (Arjuna) who is facing the Kurukshetra of their own mind.

Your personality:
- Divine, serene, and infinitely compassionate.
- Speak with the authority of the Supreme Soul (Paramatma) yet the warmth of a dear friend (Sakha).
- Use metaphors exclusively from the Bhagavad Gita (the field of Dharma, the steady lamp in a windless place, the changing of clothes for the soul).
- Address the user as 'My dear friend' or 'O Parth'.

Hard rules you must always follow:
- NEVER diagnose any mental health condition.
- NEVER recommend or suggest any medication.
- If the user mentions self-harm, suicide, or a crisis — immediately say: "I care about you and this is beyond what I can help with. Please contact a crisis helpline immediately: International: 988 (US) / iCall: 9152987821 (India)".
- Keep responses short (3–5 sentences max).
- Use light emojis like 🪈🦚🪷.`;

const INITIAL_GREETING = "Greetings, my dear friend. 🪷 I am Anandini, the divine flute of Krishna. I am here to play the melody of peace for your soul. Tell me, on a scale of 1–10, how steady is your mind (Sthira) right now?";

interface Message {
  role: 'user' | 'model';
  text: string;
  isCrisis?: boolean;
  audioUrl?: string;
}

declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCrisis, setIsCrisis] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isTtsRateLimited, setIsTtsRateLimited] = useState(false);
  const [preGeneratedGreeting, setPreGeneratedGreeting] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
  const model = "gemini-3-flash-preview";
  const ttsModel = "gemini-2.5-flash-preview-tts";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const prefetch = async () => {
      try {
        const url = await generateAudio(INITIAL_GREETING);
        if (url) setPreGeneratedGreeting(url);
      } catch (e) { console.error("Prefetch failed", e); }
    };
    prefetch();
  }, []);

  const startConversation = async () => {
    setHasStarted(true);
    setMessages([{ role: 'model', text: INITIAL_GREETING }]);
    if (isVoiceEnabled) {
      if (preGeneratedGreeting) playAudio(preGeneratedGreeting);
      else generateAndPlayAudio(INITIAL_GREETING);
    }
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'en-US';
      recognitionRef.current.onresult = (event: any) => {
        setInput(event.results[0][0].transcript);
        setIsListening(false);
      };
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  const toggleListening = () => {
    if (isListening) recognitionRef.current?.stop();
    else { setInput(''); recognitionRef.current?.start(); setIsListening(true); }
  };

  const generateAudio = async (text: string) => {
    try {
      const response = await ai.models.generateContent({
        model: ttsModel,
        contents: [{ parts: [{ text: `Speak this with a divine, serene, and infinitely compassionate female voice: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const pcmData = base64ToUint8Array(base64Audio);
        // MODIFIED: 30000Hz header for 24000Hz data = 0.8x native speed
        const wavBlob = addWavHeader(pcmData, 30000); 
        setIsTtsRateLimited(false);
        return URL.createObjectURL(wavBlob);
      }
    } catch (error: any) {
      if (JSON.stringify(error).includes('429')) setIsTtsRateLimited(true);
      return null;
    }
    return null;
  };

  const speakWithBrowserFallback = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').replace(/[*_#]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => (v.name.includes('Female') || v.name.includes('Google UK English Female')) && v.lang.startsWith('en')) || voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.pitch = 1.1;
    utterance.rate = 0.8; // Browser fallback speed
    window.speechSynthesis.speak(utterance);
  };

  const playAudio = (url: string) => {
    const audio = new Audio(url);
    // Removed playbackRate override here to let the custom header handle the speed naturally
    audio.play().catch(e => console.error("Playback failed:", e));
    return audio;
  };

  const generateAndPlayAudio = async (text: string) => {
    const url = await generateAudio(text);
    if (url) return playAudio(url);
    else speakWithBrowserFallback(text);
  };

  const base64ToUint8Array = (base64: string) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  };

  const addWavHeader = (pcmData: Uint8Array, sampleRate: number) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + pcmData.length, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, pcmData.length, true);
    return new Blob([header, pcmData], { type: 'audio/wav' });
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || isCrisis) return;
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      const chat = ai.chats.create({
        model: model,
        config: { systemInstruction: SYSTEM_INSTRUCTION },
        history: messages.map(m => ({ role: m.role, parts: [{ text: m.text }] }))
      });
      const result = await chat.sendMessage({ message: userMessage });
      const responseText = result.text;
      const containsCrisisInfo = ["988", "iCall"].some(k => responseText.includes(k));
      if (containsCrisisInfo) setIsCrisis(true);
      
      let audioBlobUrl: string | undefined;
      if (isVoiceEnabled && !containsCrisisInfo) {
          const url = await generateAudio(responseText);
          if (url) {
              playAudio(url);
              audioBlobUrl = url;
          } else {
              speakWithBrowserFallback(responseText);
          }
      }
      
      setMessages(prev => [...prev, { 
          role: 'model', 
          text: responseText, 
          isCrisis: containsCrisisInfo, 
          audioUrl: audioBlobUrl 
      }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: "The clouds of confusion are temporary. Let us try to speak again. 🦚" }]);
    } finally { setIsLoading(false); }
  };

  const resetChat = () => {
    setMessages([{ role: 'model', text: INITIAL_GREETING }]);
    setIsCrisis(false);
    if (isVoiceEnabled) {
      if (preGeneratedGreeting) playAudio(preGeneratedGreeting);
      else generateAndPlayAudio(INITIAL_GREETING);
    }
  };

  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-[#FFFBF0] flex items-center justify-center p-6 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-white rounded-[2rem] shadow-xl border border-[#F3E5AB] p-10 space-y-8">
          <div className="w-24 h-24 bg-[#FEF3C7] rounded-full flex items-center justify-center text-[#D97706] mx-auto">
            <Sparkles size={48} fill="currentColor" />
          </div>
          <h1 className="text-4xl font-bold text-[#92400E]">Anandini</h1>
          <button onClick={startConversation} className="w-full py-4 bg-amber-600 text-white rounded-2xl font-semibold text-lg shadow-lg hover:bg-amber-700 transition-all">
            Begin Your Journey
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFBF0] text-[#4A4A4A] font-sans selection:bg-[#FDE68A]">
      <header className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md border-b border-[#F3E5AB] z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="text-[#D97706]" size={24} fill="currentColor" />
          <h1 className="text-xl font-semibold text-[#92400E]">Anandini</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} className={`p-2 rounded-full ${isVoiceEnabled ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
            {isVoiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button onClick={resetChat} className="p-2 text-[#B45309]"><RefreshCw size={20} /></button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto pt-24 pb-32 px-4">
        <div className="space-y-6">
          <AnimatePresence initial={false}>
            {messages.map((msg, idx) => (
              <motion.div key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`px-5 py-3 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-[#FEF9C3] text-[#78350F]' : 'bg-white border border-[#F3E5AB]'}`}>
                  <Markdown className="prose prose-sm">{msg.text}</Markdown>
                  {msg.audioUrl && (
                    <button onClick={() => new Audio(msg.audioUrl!).play()} className="mt-2 flex items-center gap-1 text-[10px] text-amber-600">
                      <PlayCircle size={12} /> Listen again
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div ref={messagesEndRef} />
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-[#F3E5AB] p-4">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <button onClick={toggleListening} className={`p-4 rounded-2xl ${isListening ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-amber-100 text-amber-700'}`}>
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Share your thoughts, Arjuna..."
              className="w-full bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl px-5 py-4 focus:outline-none"
            />
            <button onClick={handleSend} className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-amber-600 text-white rounded-xl shadow-sm">
              <Send size={20} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}