// Notification sound using Web Audio API — generates a pleasant chime
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    const now = ctx.currentTime;

    // Soft, warm notification — lower frequencies, triangle waves, gentle volume
    // First note — warm mellow tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Second note — gentle higher tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(659.25, now + 0.08); // E5
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.06, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.35);
  } catch (e) {
    // Audio context not supported — silent fail
  }
}

// Muted chats stored in localStorage
const MUTED_KEY = 'nexo_muted_chats';

export function getMutedChats(): Set<string> {
  try {
    const stored = localStorage.getItem(MUTED_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

export function toggleMuteChat(chatId: string): boolean {
  const muted = getMutedChats();
  if (muted.has(chatId)) {
    muted.delete(chatId);
  } else {
    muted.add(chatId);
  }
  localStorage.setItem(MUTED_KEY, JSON.stringify([...muted]));
  return muted.has(chatId);
}

export function isChatMuted(chatId: string): boolean {
  return getMutedChats().has(chatId);
}

// Call ringtone
let callAudio: HTMLAudioElement | null = null;
let callAudioContext: AudioContext | null = null;
let callOscillators: { osc: OscillatorNode; gain: GainNode }[] = [];

export function playCallRingtone() {
  // Mobile-first approach: use Web Audio API directly for better mobile support
  // HTMLAudioElement often fails on mobile when screen is off or app is backgrounded
  playCallRingtoneWebAudio();
  
  // Also try HTMLAudioElement as backup for desktop
  try {
    if (callAudio) {
      callAudio.pause();
      callAudio.currentTime = 0;
    }
    callAudio = new Audio('/sounds/call_sound.mp3');
    callAudio.loop = true;
    callAudio.volume = 0.5;
    
    // Preload for faster playback
    callAudio.load();
    
    // Try to play silently (won't interrupt Web Audio)
    callAudio.play().catch(() => {
      // Silent fail - Web Audio is already playing
    });
  } catch (e) {
    // Silent fail - Web Audio is handling it
  }
}

/**
 * Alternative ringtone using Web Audio API — more reliable for autoplay
 * Uses higher volume and better frequency pattern for mobile devices
 */
function playCallRingtoneWebAudio() {
  try {
    if (!callAudioContext) {
      callAudioContext = new AudioContext();
    }
    if (callAudioContext.state === 'suspended') {
      callAudioContext.resume();
    }

    // Stop any existing oscillators
    stopCallRingtoneWebAudio();

    const ctx = callAudioContext;
    const now = ctx.currentTime;

    // Create a pleasant ringing pattern — two alternating tones
    // Pattern: 440Hz + 480Hz (classic ringtone frequencies)
    // Louder volume for mobile devices
    const ringPattern = () => {
      const duration = 2.0; // 2 seconds ring cycle
      const ringOn = 0.8;   // ring for 0.8s
      const ringOff = 1.2;  // pause for 1.2s
      
      // Tone 1: 440 Hz - louder for mobile
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      gain1.gain.setValueAtTime(0.3, now); // Increased from 0.15 to 0.3
      gain1.gain.setValueAtTime(0.3, now + ringOn);
      gain1.gain.setValueAtTime(0, now + ringOn + 0.01);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + duration);
      callOscillators.push({ osc: osc1, gain: gain1 });

      // Tone 2: 480 Hz - louder for mobile
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(480, now);
      gain2.gain.setValueAtTime(0.3, now); // Increased from 0.15 to 0.3
      gain2.gain.setValueAtTime(0.3, now + ringOn);
      gain2.gain.setValueAtTime(0, now + ringOn + 0.01);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + duration);
      callOscillators.push({ osc: osc2, gain: gain2 });

      // Schedule next ring cycle
      const scheduleNext = () => {
        if (callOscillators.length > 0) {
          ringPattern();
        }
      };
      setTimeout(scheduleNext, duration * 1000);
    };

    ringPattern();
  } catch (e) {
    console.error('Web Audio ringtone failed:', e);
  }
}

function stopCallRingtoneWebAudio() {
  try {
    // Stop all oscillators
    callOscillators.forEach(({ osc, gain }) => {
      try {
        gain.gain.setValueAtTime(0, callAudioContext!.currentTime);
        osc.stop();
      } catch (e) {
        // Already stopped
      }
    });
    callOscillators = [];
  } catch (e) {
    // Silent fail
  }
}

export function stopCallRingtone() {
  try {
    if (callAudio) {
      callAudio.pause();
      callAudio.currentTime = 0;
      callAudio = null;
    }
    stopCallRingtoneWebAudio();
  } catch (e) {
    // silent fail
  }
}

// "Абонент недоступен" sound
export function playUnavailableSound(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const audio = new Audio('/sounds/abonent_nedostupen.mp3');
      audio.volume = 0.7;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    } catch (e) {
      resolve();
    }
  });
}
