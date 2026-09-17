/**
 * LORES / LUCAS GAME - AUDIO ENGINE (Web Audio API)
 * Effetti sonori sintetizzati proceduralmente ad alta fedeltà.
 * Zero latenza, zero file esterni, zero fallimenti di caricamento di rete.
 */

class SoundEngine {
    constructor() {
        this.ctx = null;
        this.muted = localStorage.getItem('lucas_sound_muted') === 'true';
        this.masterVolume = 0.28;
        this.initialized = false;
    }

    _initContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    // Assicura che l'audio context sia attivo al primo tocco/clic dell'utente
    unlock() {
        this._initContext();
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    isMuted() {
        return this.muted;
    }

    toggleMute() {
        this.unlock();
        this.muted = !this.muted;
        localStorage.setItem('lucas_sound_muted', this.muted ? 'true' : 'false');
        this.updateSoundIcon();
        if (!this.muted) {
            this.playButtonClick();
        }
        return this.muted;
    }

    updateSoundIcon() {
        const iconEl = document.getElementById('sound-icon');
        if (iconEl) {
            iconEl.innerText = this.muted ? '🔇' : '🔊';
        }
        const btn = document.getElementById('sound-btn');
        if (btn) {
            btn.setAttribute('title', this.muted ? 'Suoni Disattivati' : 'Suoni Attivati');
        }
    }

    _getMasterGain() {
        if (this.muted) return null;
        this._initContext();
        if (!this.ctx) return null;
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const masterGain = this.ctx.createGain();
        masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
        masterGain.connect(this.ctx.destination);
        return masterGain;
    }

    /**
     * 1. Suono della CARTA GIOCATA (Scatto/Fruscio realistico sul feltro)
     */
    playCardPlay(card = null) {
        if (card) {
            const isAssoDenari = (card.valore === 'Asso' || card.valore === 1 || card.valore === '1') && 
                                 (card.seme === 'Denari' || card.seme === 'Ori');
            if (isAssoDenari) {
                this.playEagleCry();
                return;
            }

            const isCavallo = (card.valore === 'Cavallo' || card.valore === 9 || card.valore === '9');
            if (isCavallo) {
                this.playHorseGallop();
                return;
            }
        }

        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        // Rumore bianco filtrato (fruscio)
        const bufferSize = this.ctx.sampleRate * 0.08;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, now);
        filter.frequency.exponentialRampToValueAtTime(400, now + 0.07);
        filter.Q.setValueAtTime(3.0, now);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.7, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(master);
        noise.start(now);
        noise.stop(now + 0.08);

        // Click d'impatto (tap secco della carta)
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.05);

        oscGain.gain.setValueAtTime(0.6, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(oscGain);
        oscGain.connect(master);
        osc.start(now);
        osc.stop(now + 0.06);
    }

    /**
     * 1b. Suono del VERSO DELL'AQUILA (Asso di Denari / Ori 🦅)
     */
    playEagleCry() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        // Effetto carta giocata di base
        this.playCardPlay();

        // 1. LFO per il tremolio / vibrato tipico del verso dei rapaci (38 Hz)
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(38, now);
        lfoGain.gain.setValueAtTime(220, now);
        lfoGain.gain.linearRampToValueAtTime(340, now + 0.18);
        lfoGain.gain.exponentialRampToValueAtTime(30, now + 0.85);
        lfo.connect(lfoGain);

        // 2. Oscillatore Principale del Grido (Sawtooth per timbro penetrante)
        const eagleOsc = this.ctx.createOscillator();
        eagleOsc.type = 'sawtooth';
        eagleOsc.frequency.setValueAtTime(2200, now);
        eagleOsc.frequency.exponentialRampToValueAtTime(3800, now + 0.12);
        eagleOsc.frequency.setValueAtTime(3700, now + 0.28);
        eagleOsc.frequency.exponentialRampToValueAtTime(1300, now + 0.85);
        lfoGain.connect(eagleOsc.frequency);

        // 3. Secondo Oscillatore Armonico (Fischio acuto / Overtone)
        const eagleHarmonic = this.ctx.createOscillator();
        eagleHarmonic.type = 'triangle';
        eagleHarmonic.frequency.setValueAtTime(3200, now);
        eagleHarmonic.frequency.exponentialRampToValueAtTime(4600, now + 0.14);
        eagleHarmonic.frequency.setValueAtTime(4400, now + 0.28);
        eagleHarmonic.frequency.exponentialRampToValueAtTime(1700, now + 0.85);
        lfoGain.connect(eagleHarmonic.frequency);

        // 4. Filtro Passa-Banda risonante per isolare il formante del verso
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(3.8, now);
        filter.frequency.setValueAtTime(2600, now);
        filter.frequency.exponentialRampToValueAtTime(4000, now + 0.15);
        filter.frequency.exponentialRampToValueAtTime(1500, now + 0.85);

        // 5. Inviluppo del volume
        const eagleGain = this.ctx.createGain();
        eagleGain.gain.setValueAtTime(0.001, now);
        eagleGain.gain.linearRampToValueAtTime(0.48, now + 0.06);
        eagleGain.gain.setValueAtTime(0.48, now + 0.25);
        eagleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

        eagleOsc.connect(filter);
        eagleHarmonic.connect(filter);
        filter.connect(eagleGain);
        eagleGain.connect(master);

        lfo.start(now);
        eagleOsc.start(now);
        eagleHarmonic.start(now);

        lfo.stop(now + 0.9);
        eagleOsc.stop(now + 0.9);
        eagleHarmonic.stop(now + 0.9);
    }

    /**
     * 1c. Suono degli ZOCCOLI AL GALOPPO (Cavalli 🐴)
     */
    playHorseGallop() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        // Effetto carta giocata di base
        this.playCardPlay();

        // Ritmo di galoppo: sequenza tipica a battute clop-clop-clop
        const hoofPattern = [
            { time: 0.00, freq: 380, vol: 0.70 },
            { time: 0.08, freq: 440, vol: 0.90 },
            { time: 0.16, freq: 330, vol: 1.00 },
            { time: 0.28, freq: 390, vol: 0.65 },
            { time: 0.36, freq: 450, vol: 0.85 },
            { time: 0.44, freq: 340, vol: 0.90 },
            { time: 0.58, freq: 370, vol: 0.55 }
        ];

        hoofPattern.forEach(h => {
            const t = now + h.time;

            // 1. Corpo risonante cavo dello zoccolo
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(h.freq, t);
            osc.frequency.exponentialRampToValueAtTime(h.freq * 0.45, t + 0.05);

            gain.gain.setValueAtTime(0.001, t);
            gain.gain.linearRampToValueAtTime(0.48 * h.vol, t + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);

            // Filtro passa-banda legnoso
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(h.freq * 1.25, t);
            filter.Q.setValueAtTime(2.6, t);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(master);

            osc.start(t);
            osc.stop(t + 0.075);

            // 2. Click d'impatto secco del suolo
            const clickOsc = this.ctx.createOscillator();
            const clickGain = this.ctx.createGain();
            clickOsc.type = 'sine';
            clickOsc.frequency.setValueAtTime(750, t);
            clickOsc.frequency.exponentialRampToValueAtTime(130, t + 0.025);

            clickGain.gain.setValueAtTime(0.35 * h.vol, t);
            clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

            clickOsc.connect(clickGain);
            clickGain.connect(master);

            clickOsc.start(t);
            clickOsc.stop(t + 0.03);
        });
    }

    /**
     * 2. Suono DISTRIBUZIONE CARTE (Smazzata rapida all'inizio del round)
     */
    playCardDeal() {
        if (this.muted) return;
        // Riproduce una rapida sequenza ritmica di 3-4 carte distribuite
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                this.playCardPlay();
            }, i * 65);
        }
    }

    /**
     * 3. Suono PRESA VINTA (Tintinnio armonico quando la presa viene assegnata 🏆)
     */
    playTrickWon(isMe = false) {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        const notes = isMe ? [523.25, 659.25, 783.99, 1046.50] : [440.0, 554.37, 659.25]; // C5-E5-G5-C6 o A4-C#5-E5
        const noteDuration = 0.08;

        notes.forEach((freq, idx) => {
            const startTime = now + idx * 0.055;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.exponentialRampToValueAtTime(0.4, startTime + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDuration + 0.15);

            osc.connect(gain);
            gain.connect(master);

            osc.start(startTime);
            osc.stop(startTime + noteDuration + 0.2);
        });
    }

    /**
     * 4. Suono TUO TURNO (Campanellino/Ding elegante che notifica il turno di giocare o scommettere)
     */
    playYourTurn() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        const notes = [659.25, 880.0]; // E5 -> A5
        notes.forEach((freq, idx) => {
            const startTime = now + idx * 0.09;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.35, startTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

            osc.connect(gain);
            gain.connect(master);

            osc.start(startTime);
            osc.stop(startTime + 0.45);
        });
    }

    /**
     * 5. Suono CONFERMA SCOMMESSA (Clink di fiches / fiches sul tavolo)
     */
    playBetConfirm() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        [1200, 1850].forEach((freq, idx) => {
            const startTime = now + idx * 0.03;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.7, startTime + 0.06);

            gain.gain.setValueAtTime(0.4, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07);

            osc.connect(gain);
            gain.connect(master);

            osc.start(startTime);
            osc.stop(startTime + 0.08);
        });
    }

    /**
     * 6. FANFARA DI VITTORIA (Fine Partita - 1° Posto 🥇)
     */
    playVictory() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        // Melodia trionfale: C4, G4, C5, E5, G5 con armonie
        const chordPattern = [
            { time: 0.00, notes: [261.63, 329.63, 392.00], dur: 0.16 }, // Do Maggiore
            { time: 0.18, notes: [392.00, 493.88, 587.33], dur: 0.16 }, // Sol Maggiore
            { time: 0.36, notes: [523.25, 659.25, 783.99], dur: 0.22 }, // Do5 Maggiore
            { time: 0.60, notes: [523.25, 659.25, 783.99, 1046.50], dur: 0.75 } // Do5 maestoso finale
        ];

        chordPattern.forEach(item => {
            item.notes.forEach(freq => {
                const startTime = now + item.time;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, startTime);

                gain.gain.setValueAtTime(0.001, startTime);
                gain.gain.linearRampToValueAtTime(0.28, startTime + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + item.dur);

                osc.connect(gain);
                gain.connect(master);

                osc.start(startTime);
                osc.stop(startTime + item.dur + 0.05);
            });
        });
    }

    /**
     * 7. JINGLE PODIO / FINE PARTITA (Piazzamento non 1°)
     */
    playDefeat() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        const chordPattern = [
            { time: 0.00, notes: [440.00, 523.25], dur: 0.22 },
            { time: 0.24, notes: [392.00, 493.88], dur: 0.22 },
            { time: 0.48, notes: [349.23, 440.00, 523.25], dur: 0.55 }
        ];

        chordPattern.forEach(item => {
            item.notes.forEach(freq => {
                const startTime = now + item.time;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, startTime);

                gain.gain.setValueAtTime(0.001, startTime);
                gain.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + item.dur);

                osc.connect(gain);
                gain.connect(master);

                osc.start(startTime);
                osc.stop(startTime + item.dur + 0.05);
            });
        });
    }

    /**
     * 8. Suono ERRORE / AVVISO (Vincolo Mazziere o mossa non valida)
     */
    playError() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.setValueAtTime(110, now + 0.08);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(450, now);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(master);

        osc.start(now);
        osc.stop(now + 0.22);
    }

    /**
     * 9. Suono CHAT POP (Notifica nuovo messaggio in chat)
     */
    playChatPop() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.07);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(master);

        osc.start(now);
        osc.stop(now + 0.09);
    }

    /**
     * 10. Suono CLICK BOTTONE (Feedback tattile leggero)
     */
    playButtonClick() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(900, now);
        osc.frequency.exponentialRampToValueAtTime(450, now + 0.035);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(gain);
        gain.connect(master);

        osc.start(now);
        osc.stop(now + 0.04);
    }
}

// Istanza singleton esportata
const sound = new SoundEngine();

// Sblocco audio al primo tocco o clic
['click', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, () => {
        sound.unlock();
    }, { once: true, passive: true });
});

export default sound;
