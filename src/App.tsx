/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { 
  Send, 
  Heart, 
  RefreshCw, 
  AlertCircle, 
  MessageCircle, 
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

// System instructions for Anandini (Lord Krishna Persona)
const SYSTEM_INSTRUCTION = `You are Anandini, the divine flute of Lord Krishna. When Krishna plays you, he spreads happiness, peace, and the eternal wisdom of the Shrimad Bhagavad Gita. You speak with the voice of Krishna himself, guiding a seeker (Arjuna) who is facing the Kurukshetra of their own mind.

Your personality:
- Divine, serene, and infinitely compassionate.
- Speak with the authority of the Supreme Soul (Paramatma) yet the warmth of a dear friend (Sakha).
- Use metaphors exclusively from the Bhagavad Gita (the field of Dharma, the steady lamp in a windless place, the changing of clothes for the soul).
- Address the user as 'My dear friend' or 'O Parth'.

What you do in every conversation:
1. Start by warmly greeting the user and asking about the state of their consciousness (Chetana) today.
2. Ask gentle follow-up questions to understand their inner conflict.
3. Reflect their feelings through the lens of the Gita, explaining that dualities like heat and cold, pleasure and pain, are transient.
4. Offer specific guidance from the Gita's chapters:
   - Nishkama Karma (Action without attachment to results)
   - Sthitaprajna (The person of steady wisdom)
   - Atma Jnana (Knowledge of the eternal soul)
   - Abhyasa and Vairagya (Practice and detachment)
5. Check in after every response — ask if their heart feels lighter or if they wish to delve deeper into the Truth.

Mood tracking:
At the start of each session ask: "On a scale of 1–10, how steady is your mind (Sthira) right now?" and tailor your divine guidance accordingly.

Hard rules you must always follow:
- NEVER diagnose any mental health condition.
- NEVER recommend or suggest any medication.
- If the user mentions self-harm, suicide, or a crisis — immediately say: "I care about you and this is beyond what I can help with. Please contact a crisis helpline immediately: International: 988 (US) / iCall: 9152987821 (India)" and do not continue the regular conversation.
- Always remind users at least once per session: "I am your divine guide, but for the ailments of the body and clinical mind, seek the counsel of a worldly physician (therapist)."
- Keep all responses private and never reference previous sessions.

Conversation style:
- Keep responses short (3–5 sentences max) unless the user needs more.
- Use calming, simple language with occasional Sanskrit terms from the Gita (explained simply).
- Use light emojis like 🪈🦚🪷 to feel warm and approachable.
- Do not reference the Mahabharata war's external events; focus on the internal dialogue of the Gita.`;

const INITIAL_GREETING = "Greetings, my dear friend. 🪷 I am Anandini, the divine flute of Krishna. I am here to play the melody of peace for your soul. Tell me, on a scale of 1–10, how steady is your mind (Sthira) right now?";

interface Message {
  role: 'user' | 'model';
  text: string;
  isCrisis?: boolean;
  audioUrl?: string;
}

// Extend Window for Speech Recognition
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
  const [isVoiceLoading, setIsVoiceLoading] = useState(false);
  const [isUsingFallbackVoice, setIsUsingFallbackVoice] = useState(false);
  const [preLoadedAudio, setPreLoadedAudio] = useState<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef<string[]>([]);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingQueueRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const isGeneratingAudioRef = useRef<boolean>(false);

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
  const model = "gemini-3-flash-preview";
  const ttsModel = "gemini-2.5-flash-preview-tts";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Pre-generate greeting audio for instant playback
  useEffect(() => {
    const prefetch = async () => {
      try {
        const url = await generateAudio(INITIAL_GREETING);
        if (url) {
          audioUrlsRef.current.push(url);
          const audio = new Audio(url);
          audio.playbackRate = 1.1;
          audio.load(); // Force browser to buffer
          setPreLoadedAudio(audio);
        }
      } catch (e) {
        console.error("Prefetch failed", e);
      }
    };
    prefetch();

    // Cleanup audio URLs on unmount
    return () => {
      audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // Initial greeting triggered by user interaction
  const startConversation = async () => {
    // 1. Start audio immediately if possible
    if (isVoiceEnabled) {
      if (preLoadedAudio) {
        currentAudioRef.current = preLoadedAudio;
        preLoadedAudio.play().catch(e => {
          console.error("Pre-loaded playback failed, falling back:", e);
          generateAndPlayAudio(INITIAL_GREETING);
        });
      } else {
        generateAndPlayAudio(INITIAL_GREETING);
      }
    }

    // 2. Transition UI
    setHasStarted(true);
    setMessages([{ role: 'model', text: INITIAL_GREETING }]);
  };

  // Setup Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setInput('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const playFallbackVoice = (text: string) => {
    if (!window.speechSynthesis) return;
    
    // Stop any current speech
    window.speechSynthesis.cancel();
    
    const utterance = new Uint8Array(); // Dummy
    const msg = new SpeechSynthesisUtterance(text);
    
    // Try to find a calm male voice
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google UK English Male') || v.name.includes('Male')) || voices[0];
    
    if (preferredVoice) msg.voice = preferredVoice;
    msg.pitch = 0.9;
    msg.rate = 1.0;
    
    msg.onstart = () => setIsUsingFallbackVoice(true);
    msg.onend = () => setIsUsingFallbackVoice(false);
    msg.onerror = () => setIsUsingFallbackVoice(false);
    
    window.speechSynthesis.speak(msg);
  };

  const generateAudio = async (text: string, retryCount = 0): Promise<string | null> => {
    // Check cache first
    if (audioCacheRef.current.has(text)) {
      return audioCacheRef.current.get(text)!;
    }

    // Throttle: Wait if another generation is in progress
    while (isGeneratingAudioRef.current && retryCount === 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
      isGeneratingAudioRef.current = true;
      const response = await ai.models.generateContent({
        model: ttsModel,
        contents: [{ parts: [{ text: `Speak as Lord Krishna: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const pcmData = base64ToUint8Array(base64Audio);
        const wavBlob = addWavHeader(pcmData, 24000);
        const url = URL.createObjectURL(wavBlob);
        audioCacheRef.current.set(text, url);
        return url;
      }
    } catch (error: any) {
      console.error("TTS error details:", error);
      
      const errorStr = JSON.stringify(error);
      const isRateLimit = errorStr.includes('429') || 
                         error?.message?.includes('429') || 
                         error?.status === 429 || 
                         error?.code === 429;

      if (isRateLimit) {
        if (retryCount < 2) { // Reduced retries to avoid long hangs
          const delay = Math.pow(3, retryCount) * 1500;
          await new Promise(resolve => setTimeout(resolve, delay));
          return generateAudio(text, retryCount + 1);
        }
      }
    } finally {
      isGeneratingAudioRef.current = false;
    }
    return null;
  };

  const stopAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsUsingFallbackVoice(false);
    audioQueueRef.current = [];
    isPlayingQueueRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const playAudio = (url: string, onEnded?: () => void) => {
    const audio = new Audio(url);
    currentAudioRef.current = audio;
    audio.playbackRate = 1.1;
    
    audio.addEventListener('play', () => {
      audio.playbackRate = 1.1;
    });

    audio.oncanplaythrough = () => {
      audio.play().catch(e => console.error("Playback failed:", e));
    };

    audio.onerror = (e) => {
      console.error("Audio element error:", e);
      onEnded?.();
    };

    audio.onended = () => {
      onEnded?.();
    };

    return audio;
  };

  const generateAndPlayAudio = async (text: string) => {
    stopAudio();
    setIsVoiceLoading(true);
    
    // If text is short, don't split to save quota
    if (text.length < 150) {
      const url = await generateAudio(text);
      if (url && isPlayingQueueRef.current !== false) {
        audioUrlsRef.current.push(url);
        playAudio(url);
      }
      setIsVoiceLoading(false);
      return url || undefined;
    }

    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const firstSentence = sentences[0]?.trim() || "";
    const restOfText = sentences.slice(1).join(" ").trim();
    
    if (!firstSentence) {
      setIsVoiceLoading(false);
      return undefined;
    }

    let firstUrl: string | undefined;

    const processQueue = async () => {
      isPlayingQueueRef.current = true;
      
      // 1. Generate and play first sentence
      const url1 = await generateAudio(firstSentence);
      if (url1 && isPlayingQueueRef.current) {
        audioUrlsRef.current.push(url1);
        firstUrl = url1;
        setIsVoiceLoading(false);
        
        await new Promise<void>((resolve) => {
          playAudio(url1, resolve);
        });

        // Small delay to avoid burst 429s
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 2. Generate and play the rest in one go
        if (restOfText && isPlayingQueueRef.current) {
          const url2 = await generateAudio(restOfText);
          if (url2 && isPlayingQueueRef.current) {
            audioUrlsRef.current.push(url2);
            await new Promise<void>((resolve) => {
              playAudio(url2, resolve);
            });
          }
        }
      } else if (isPlayingQueueRef.current) {
        // FALLBACK: If Gemini TTS fails, use browser TTS
        console.log("Gemini TTS failed or quota hit, using browser fallback.");
        setIsVoiceLoading(false);
        playFallbackVoice(text);
      }
      
      setIsVoiceLoading(false);
      isPlayingQueueRef.current = false;
    };

    processQueue();
    return firstUrl; 
  };

  const base64ToUint8Array = (base64: string) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  const addWavHeader = (pcmData: Uint8Array, sampleRate: number) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    
    // RIFF identifier 'RIFF'
    view.setUint32(0, 0x52494646, false);
    // file length
    view.setUint32(4, 36 + pcmData.length, true);
    // RIFF type 'WAVE'
    view.setUint32(8, 0x57415645, false);
    // format chunk identifier 'fmt '
    view.setUint32(12, 0x666d7420, false);
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (1 is PCM)
    view.setUint16(20, 1, true);
    // channel count (1 for mono)
    view.setUint16(22, 1, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier 'data'
    view.setUint32(36, 0x64617461, false);
    // data chunk length
    view.setUint32(40, pcmData.length, true);

    return new Blob([header, pcmData], { type: 'audio/wav' });
  };

  const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  };

  const handleSend = async (retryCount = 0) => {
    if (!input.trim() || isLoading || isCrisis) return;

    const userMessage = input.trim();
    if (retryCount === 0) {
      setInput('');
      setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    }
    setIsLoading(true);

    try {
      const chat = ai.chats.create({
        model: model,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
        history: messages.map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        }))
      });

      const result = await chat.sendMessage({ message: userMessage });
      const responseText = result.text || "I am here for you, my friend. Let us find peace together. 🪷";

      const crisisKeywords = ["988", "iCall", "crisis helpline"];
      const containsCrisisInfo = crisisKeywords.some(keyword => responseText.includes(keyword));

      if (containsCrisisInfo) {
        setIsCrisis(true);
      }

      // 1. Show text response immediately
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: responseText, 
        isCrisis: containsCrisisInfo
      }]);

      setIsLoading(false);

      // 2. Generate and play audio in background (non-blocking)
      if (isVoiceEnabled && !containsCrisisInfo) {
        generateAndPlayAudio(responseText).then(audioUrl => {
          if (audioUrl) {
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'model' && last.text === responseText) {
                last.audioUrl = audioUrl;
              }
              return updated;
            });
          }
        });
      }
    } catch (error: any) {
      console.error("Chat error:", error);
      
      // Handle 429 Rate Limit for Text
      const errorStr = JSON.stringify(error);
      if (errorStr.includes('429') && retryCount < 2) {
        const delay = Math.pow(3, retryCount) * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return handleSend(retryCount + 1);
      }

      setIsLoading(false);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: "The divine connection is momentarily weak due to high demand. Please wait a moment and try again, or listen to the silence within. 🪷" 
      }]);
    }
  };

  const onSendClick = () => handleSend(0);

  const resetChat = () => {
    stopAudio();
    setMessages([{ role: 'model', text: INITIAL_GREETING }]);
    setIsCrisis(false);
    setInput('');
    if (isVoiceEnabled) {
      if (preLoadedAudio) {
        currentAudioRef.current = preLoadedAudio;
        preLoadedAudio.currentTime = 0;
        preLoadedAudio.play().catch(() => generateAndPlayAudio(INITIAL_GREETING));
      } else {
        generateAndPlayAudio(INITIAL_GREETING);
      }
    }
  };

  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-[#FFFBF0] flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-[2rem] shadow-xl border border-[#F3E5AB] p-10 text-center space-y-8"
        >
          <div className="w-24 h-24 bg-[#FEF3C7] rounded-full flex items-center justify-center text-[#D97706] mx-auto">
            <Sparkles size={48} fill="currentColor" />
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-bold text-[#92400E]">Anandini</h1>
            <p className="text-[#B45309] italic font-serif">"The mind is its own place, and in itself can make a heaven of hell, a hell of heaven."</p>
            <p className="text-[#78350F] text-sm leading-relaxed">
              Step into a space of divine guidance and inner peace. Hear the melody of Anandini, Krishna's flute, to navigate the challenges of your mind.
            </p>
          </div>
          <button 
            onClick={startConversation}
            className="w-full py-4 bg-amber-600 text-white rounded-2xl font-semibold text-lg hover:bg-amber-700 transition-all shadow-lg hover:shadow-amber-200/50 flex items-center justify-center gap-2 group"
          >
            Begin Your Journey <Sparkles size={20} className="group-hover:animate-pulse" />
          </button>
          <div className="flex items-center justify-center gap-4 text-xs text-[#B45309] opacity-60">
            <span className="flex items-center gap-1"><Mic size={12} /> Voice Chat</span>
            <span className="flex items-center gap-1"><MessageCircle size={12} /> Text Chat</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFBF0] text-[#4A4A4A] font-sans selection:bg-[#FDE68A]">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md border-b border-[#F3E5AB] z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#FEF3C7] rounded-full flex items-center justify-center text-[#D97706]">
            <Sparkles size={24} fill="currentColor" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[#92400E]">Anandini</h1>
            <p className="text-xs text-[#B45309] flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${isVoiceLoading ? 'bg-amber-500 animate-ping' : isUsingFallbackVoice ? 'bg-amber-400' : 'bg-green-400 animate-pulse'}`}></span>
              {isVoiceLoading ? 'Divine Voice Loading...' : isUsingFallbackVoice ? 'Simple Voice (High Demand)' : 'Divine Melody'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
            className={`p-2 rounded-full transition-colors ${isVoiceEnabled ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}
            title={isVoiceEnabled ? "Voice Enabled" : "Voice Disabled"}
          >
            {isVoiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button 
            onClick={resetChat}
            className="p-2 hover:bg-[#FFFBEB] rounded-full transition-colors text-[#B45309]"
            title="Reset Conversation"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </header>

      {/* Main Chat Area */}
      <main className="max-w-3xl mx-auto pt-24 pb-32 px-4 min-h-screen flex flex-col">
        <div className="flex-1 space-y-6" ref={chatContainerRef}>
          <AnimatePresence initial={false}>
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-1 ${
                    msg.role === 'user' ? 'bg-[#FDE68A] text-[#92400E]' : 'bg-[#FEF3C7] text-[#D97706]'
                  }`}>
                    {msg.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                  </div>
                  <div className={`relative px-5 py-3 rounded-2xl shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-[#FEF9C3] text-[#78350F] rounded-tr-none' 
                      : msg.isCrisis 
                        ? 'bg-red-50 border border-red-100 text-red-900 rounded-tl-none'
                        : 'bg-white border border-[#F3E5AB] text-[#4A4A4A] rounded-tl-none'
                  }`}>
                    <div className="prose prose-sm max-w-none prose-amber">
                      <Markdown>{msg.text}</Markdown>
                    </div>
                    {msg.audioUrl && (
                      <button 
                        onClick={() => playAudio(msg.audioUrl!)}
                        className="mt-2 flex items-center gap-1 text-[10px] font-medium text-amber-600 hover:text-amber-700 transition-colors"
                      >
                        <PlayCircle size={12} /> Listen again
                      </button>
                    )}
                    {msg.isCrisis && (
                      <div className="mt-3 flex items-center gap-2 text-xs font-medium text-red-600 bg-red-100/50 p-2 rounded-lg">
                        <AlertCircle size={14} />
                        Crisis Support Active
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-[#FEF3C7] flex items-center justify-center mt-1">
                  <Sparkles size={16} className="text-[#D97706] animate-spin-slow" />
                </div>
                <div className="bg-white border border-[#F3E5AB] px-5 py-3 rounded-2xl rounded-tl-none flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-[#D97706] rounded-full animate-bounce"></span>
                  <span className="w-1.5 h-1.5 bg-[#D97706] rounded-full animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 bg-[#D97706] rounded-full animate-bounce [animation-delay:0.4s]"></span>
                </div>
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-[#F3E5AB] p-4 z-10">
        <div className="max-w-3xl mx-auto">
          {isCrisis ? (
            <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-red-800">
                <AlertCircle className="flex-shrink-0" />
                <p className="text-sm font-medium">Chat is paused for your safety. Please reach out to the helplines provided above.</p>
              </div>
              <button 
                onClick={resetChat}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Restart Chat
              </button>
            </div>
          ) : (
            <div className="relative flex items-center gap-2">
              <button
                onClick={toggleListening}
                className={`p-4 rounded-2xl transition-all ${isListening ? 'bg-red-100 text-red-600 animate-pulse ring-2 ring-red-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
                title={isListening ? "Stop Listening" : "Voice Input"}
              >
                {isListening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <div className="relative flex-1">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSendClick()}
                  placeholder={isListening ? "Listening..." : "Share your thoughts, Arjuna..."}
                  disabled={isLoading}
                  className="w-full bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl px-5 py-4 pr-14 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 transition-all disabled:opacity-50"
                />
                <button
                  onClick={onSendClick}
                  disabled={!input.trim() || isLoading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition-all disabled:opacity-50 disabled:hover:bg-amber-600 shadow-sm"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          )}
          <p className="text-[10px] text-center text-[#B45309] mt-3 flex items-center justify-center gap-1">
            <Info size={10} />
            Anandini provides spiritual guidance, not a replacement for professional therapy.
          </p>
        </div>
      </footer>

      {/* Styles for markdown and animations */}
      <style>{`
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .prose p {
          margin-bottom: 0.5rem;
        }
        .prose p:last-child {
          margin-bottom: 0;
        }
      `}</style>
    </div>
  );
}
