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
            btn.className = this.muted ? 'sound-muted' : 'sound-active';
        }
        const badge = document.getElementById('sound-status-badge');
        if (badge) {
            badge.className = this.muted ? 'sound-badge-muted' : 'sound-badge-on';
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
     * Grido realistico di rapace: multi-layer con vibrato, armoniche, e componente di fiato.
     */
    playEagleCry() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        // Effetto carta giocata di base (ritardato leggermente per non sovrapporsi)
        this.playCardPlay();

        const duration = 1.4; // Durata totale del grido

        // === BOOST del master per il grido (l'aquila deve farsi sentire!) ===
        const cryMaster = this.ctx.createGain();
        cryMaster.gain.setValueAtTime(1.6, now);
        cryMaster.connect(master);

        // === 1. LFO VIBRATO (tremolio rapace, accelera nel corpo del grido) ===
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(28, now);
        lfo.frequency.linearRampToValueAtTime(42, now + 0.3);
        lfo.frequency.linearRampToValueAtTime(35, now + 0.8);
        lfo.frequency.linearRampToValueAtTime(20, now + duration);
        lfoGain.gain.setValueAtTime(180, now);
        lfoGain.gain.linearRampToValueAtTime(380, now + 0.2);
        lfoGain.gain.setValueAtTime(350, now + 0.5);
        lfoGain.gain.exponentialRampToValueAtTime(40, now + duration);
        lfo.connect(lfoGain);

        // === 2. LFO AMPIEZZA (tremolo naturale nel grido) ===
        const ampLfo = this.ctx.createOscillator();
        const ampLfoGain = this.ctx.createGain();
        ampLfo.type = 'sine';
        ampLfo.frequency.setValueAtTime(6, now);
        ampLfo.frequency.linearRampToValueAtTime(11, now + 0.4);
        ampLfo.frequency.linearRampToValueAtTime(5, now + duration);
        ampLfoGain.gain.setValueAtTime(0.15, now);
        ampLfo.connect(ampLfoGain);

        // === 3. OSCILLATORE PRINCIPALE (Sawtooth — timbro penetrante da rapace) ===
        const eagleOsc = this.ctx.createOscillator();
        eagleOsc.type = 'sawtooth';
        // Contorno di frequenza: attacco rapido verso l'acuto, poi discesa lamentosa
        eagleOsc.frequency.setValueAtTime(1800, now);
        eagleOsc.frequency.exponentialRampToValueAtTime(3600, now + 0.08);
        eagleOsc.frequency.exponentialRampToValueAtTime(4200, now + 0.18);
        eagleOsc.frequency.setValueAtTime(4000, now + 0.35);
        eagleOsc.frequency.exponentialRampToValueAtTime(3200, now + 0.65);
        eagleOsc.frequency.exponentialRampToValueAtTime(2000, now + 1.0);
        eagleOsc.frequency.exponentialRampToValueAtTime(1200, now + duration);
        lfoGain.connect(eagleOsc.frequency);

        // === 4. SECONDO ARMONICO (Triangle, un'ottava sotto — corpo del grido) ===
        const eagleHarmonic = this.ctx.createOscillator();
        eagleHarmonic.type = 'triangle';
        eagleHarmonic.frequency.setValueAtTime(900, now);
        eagleHarmonic.frequency.exponentialRampToValueAtTime(1800, now + 0.08);
        eagleHarmonic.frequency.exponentialRampToValueAtTime(2100, now + 0.18);
        eagleHarmonic.frequency.setValueAtTime(2000, now + 0.35);
        eagleHarmonic.frequency.exponentialRampToValueAtTime(1600, now + 0.65);
        eagleHarmonic.frequency.exponentialRampToValueAtTime(1000, now + 1.0);
        eagleHarmonic.frequency.exponentialRampToValueAtTime(600, now + duration);
        lfoGain.connect(eagleHarmonic.frequency);

        // === 5. TERZO ARMONICO (Overtone acuto, detuned per spessore) ===
        const eagleOvertone = this.ctx.createOscillator();
        eagleOvertone.type = 'sawtooth';
        eagleOvertone.frequency.setValueAtTime(2700, now);
        eagleOvertone.frequency.exponentialRampToValueAtTime(5400, now + 0.08);
        eagleOvertone.frequency.exponentialRampToValueAtTime(6300, now + 0.18);
        eagleOvertone.frequency.setValueAtTime(6000, now + 0.35);
        eagleOvertone.frequency.exponentialRampToValueAtTime(4800, now + 0.65);
        eagleOvertone.frequency.exponentialRampToValueAtTime(3000, now + 1.0);
        eagleOvertone.frequency.exponentialRampToValueAtTime(1800, now + duration);
        lfoGain.connect(eagleOvertone.frequency);

        const overtoneGain = this.ctx.createGain();
        overtoneGain.gain.setValueAtTime(0.3, now);

        // === 6. COMPONENTE DI FIATO (rumore filtrato — respiro/aria del rapace) ===
        const breathDuration = duration + 0.1;
        const breathBufSize = Math.floor(this.ctx.sampleRate * breathDuration);
        const breathBuf = this.ctx.createBuffer(1, breathBufSize, this.ctx.sampleRate);
        const breathData = breathBuf.getChannelData(0);
        for (let i = 0; i < breathBufSize; i++) {
            breathData[i] = Math.random() * 2 - 1;
        }
        const breathNoise = this.ctx.createBufferSource();
        breathNoise.buffer = breathBuf;

        const breathFilter = this.ctx.createBiquadFilter();
        breathFilter.type = 'bandpass';
        breathFilter.Q.setValueAtTime(2.5, now);
        breathFilter.frequency.setValueAtTime(2800, now);
        breathFilter.frequency.exponentialRampToValueAtTime(5000, now + 0.15);
        breathFilter.frequency.exponentialRampToValueAtTime(3000, now + 0.5);
        breathFilter.frequency.exponentialRampToValueAtTime(1800, now + duration);

        const breathGain = this.ctx.createGain();
        breathGain.gain.setValueAtTime(0.001, now);
        breathGain.gain.linearRampToValueAtTime(0.22, now + 0.05);
        breathGain.gain.setValueAtTime(0.20, now + 0.3);
        breathGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        // === 7. FILTRO FORMANTE principale (simula la cavità vocale del rapace) ===
        const formant1 = this.ctx.createBiquadFilter();
        formant1.type = 'bandpass';
        formant1.Q.setValueAtTime(5.0, now);
        formant1.frequency.setValueAtTime(2800, now);
        formant1.frequency.exponentialRampToValueAtTime(4500, now + 0.15);
        formant1.frequency.setValueAtTime(4200, now + 0.4);
        formant1.frequency.exponentialRampToValueAtTime(2000, now + duration);

        // Secondo formante (nasale/risonanza secondaria)
        const formant2 = this.ctx.createBiquadFilter();
        formant2.type = 'peaking';
        formant2.Q.setValueAtTime(3.0, now);
        formant2.gain.setValueAtTime(8, now);
        formant2.frequency.setValueAtTime(5500, now);
        formant2.frequency.exponentialRampToValueAtTime(3500, now + 0.5);
        formant2.frequency.exponentialRampToValueAtTime(2500, now + duration);

        // === 8. INVILUPPO VOLUME PRINCIPALE ===
        const eagleGain = this.ctx.createGain();
        eagleGain.gain.setValueAtTime(0.001, now);
        eagleGain.gain.linearRampToValueAtTime(0.55, now + 0.04);
        eagleGain.gain.linearRampToValueAtTime(0.60, now + 0.12);
        eagleGain.gain.setValueAtTime(0.55, now + 0.35);
        eagleGain.gain.setValueAtTime(0.50, now + 0.6);
        eagleGain.gain.exponentialRampToValueAtTime(0.08, now + 1.1);
        eagleGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        // === ROUTING ===
        eagleOsc.connect(formant1);
        eagleHarmonic.connect(formant1);
        eagleOvertone.connect(overtoneGain);
        overtoneGain.connect(formant1);
        formant1.connect(formant2);
        formant2.connect(eagleGain);

        breathNoise.connect(breathFilter);
        breathFilter.connect(breathGain);
        breathGain.connect(cryMaster);

        // Collegamento tremolo ampiezza
        ampLfoGain.connect(eagleGain.gain);
        eagleGain.connect(cryMaster);

        // === START / STOP ===
        lfo.start(now);
        ampLfo.start(now);
        eagleOsc.start(now);
        eagleHarmonic.start(now);
        eagleOvertone.start(now);
        breathNoise.start(now);

        const stopTime = now + duration + 0.1;
        lfo.stop(stopTime);
        ampLfo.stop(stopTime);
        eagleOsc.stop(stopTime);
        eagleHarmonic.stop(stopTime);
        eagleOvertone.stop(stopTime);
        breathNoise.stop(stopTime);
    }

    /**
     * 1c. Suono degli ZOCCOLI AL GALOPPO (Cavalli 🐴)
     * Galoppo realistico: ritmo a 3 tempi, impatto pesante, risonanza del terreno.
     */
    playHorseGallop() {
        const master = this._getMasterGain();
        if (!master) return;
        const now = this.ctx.currentTime;

        // Effetto carta giocata di base
        this.playCardPlay();

        // === BOOST VOLUME per il galoppo (deve sentirsi chiaramente sopra la carta) ===
        const gallopMaster = this.ctx.createGain();
        gallopMaster.gain.setValueAtTime(2.5, now);
        gallopMaster.connect(master);

        // Ritmo realistico di galoppo a 3 tempi (canter):
        // Battuta 1: forte (zoccolo posteriore), Battuta 2: media (zoccolo diagonale),
        // Battuta 3: leggera (zoccolo anteriore), poi pausa di sospensione
        // Ripetuto 2 volte per dare il senso del galoppo
        const hoofPattern = [
            // Prima battuta di galoppo
            { time: 0.00, freq: 220, vol: 1.00, accent: true  },
            { time: 0.09, freq: 280, vol: 0.80, accent: false },
            { time: 0.16, freq: 320, vol: 0.60, accent: false },
            // Pausa di sospensione (~0.10s)
            // Seconda battuta di galoppo
            { time: 0.30, freq: 230, vol: 0.95, accent: true  },
            { time: 0.39, freq: 290, vol: 0.75, accent: false },
            { time: 0.46, freq: 310, vol: 0.55, accent: false },
            // Terza battuta (eco finale)
            { time: 0.60, freq: 240, vol: 0.70, accent: true  },
            { time: 0.69, freq: 270, vol: 0.45, accent: false },
        ];

        hoofPattern.forEach(h => {
            const t = now + h.time;

            // === Layer 1: IMPATTO BASSO (thud del terreno - sine a bassa frequenza) ===
            const thudOsc = this.ctx.createOscillator();
            const thudGain = this.ctx.createGain();
            thudOsc.type = 'sine';
            thudOsc.frequency.setValueAtTime(h.freq * 0.4, t);
            thudOsc.frequency.exponentialRampToValueAtTime(h.freq * 0.15, t + 0.08);

            const thudVol = (h.accent ? 0.85 : 0.55) * h.vol;
            thudGain.gain.setValueAtTime(0.001, t);
            thudGain.gain.linearRampToValueAtTime(thudVol, t + 0.003);
            thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);

            thudOsc.connect(thudGain);
            thudGain.connect(gallopMaster);
            thudOsc.start(t);
            thudOsc.stop(t + 0.12);

            // === Layer 2: CORPO RISONANTE LEGNOSO (zoccolo = corno duro su terra) ===
            const bodyOsc = this.ctx.createOscillator();
            const bodyGain = this.ctx.createGain();
            bodyOsc.type = 'triangle';
            bodyOsc.frequency.setValueAtTime(h.freq, t);
            bodyOsc.frequency.exponentialRampToValueAtTime(h.freq * 0.35, t + 0.07);

            const bodyFilter = this.ctx.createBiquadFilter();
            bodyFilter.type = 'bandpass';
            bodyFilter.frequency.setValueAtTime(h.freq * 1.5, t);
            bodyFilter.frequency.exponentialRampToValueAtTime(h.freq * 0.6, t + 0.06);
            bodyFilter.Q.setValueAtTime(4.0, t);

            const bodyVol = (h.accent ? 0.70 : 0.50) * h.vol;
            bodyGain.gain.setValueAtTime(0.001, t);
            bodyGain.gain.linearRampToValueAtTime(bodyVol, t + 0.003);
            bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

            bodyOsc.connect(bodyFilter);
            bodyFilter.connect(bodyGain);
            bodyGain.connect(gallopMaster);
            bodyOsc.start(t);
            bodyOsc.stop(t + 0.10);

            // === Layer 3: CLICK ACUTO (attacco secco dello zoccolo) ===
            const clickOsc = this.ctx.createOscillator();
            const clickGain = this.ctx.createGain();
            clickOsc.type = 'square';
            clickOsc.frequency.setValueAtTime(h.accent ? 900 : 750, t);
            clickOsc.frequency.exponentialRampToValueAtTime(150, t + 0.02);

            const clickFilter = this.ctx.createBiquadFilter();
            clickFilter.type = 'highpass';
            clickFilter.frequency.setValueAtTime(300, t);

            const clickVol = (h.accent ? 0.60 : 0.40) * h.vol;
            clickGain.gain.setValueAtTime(clickVol, t);
            clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

            clickOsc.connect(clickFilter);
            clickFilter.connect(clickGain);
            clickGain.connect(gallopMaster);
            clickOsc.start(t);
            clickOsc.stop(t + 0.04);

            // === Layer 4: RUMORE DI TERRA (polvere/detriti sollevati dall'impatto) ===
            const dirtDuration = h.accent ? 0.06 : 0.04;
            const dirtBufSize = Math.floor(this.ctx.sampleRate * dirtDuration);
            const dirtBuf = this.ctx.createBuffer(1, dirtBufSize, this.ctx.sampleRate);
            const dirtData = dirtBuf.getChannelData(0);
            for (let i = 0; i < dirtBufSize; i++) {
                dirtData[i] = Math.random() * 2 - 1;
            }
            const dirtNoise = this.ctx.createBufferSource();
            dirtNoise.buffer = dirtBuf;

            const dirtFilter = this.ctx.createBiquadFilter();
            dirtFilter.type = 'bandpass';
            dirtFilter.frequency.setValueAtTime(h.freq * 2, t);
            dirtFilter.Q.setValueAtTime(1.5, t);

            const dirtGain = this.ctx.createGain();
            const dirtVol = (h.accent ? 0.45 : 0.25) * h.vol;
            dirtGain.gain.setValueAtTime(dirtVol, t);
            dirtGain.gain.exponentialRampToValueAtTime(0.001, t + dirtDuration);

            dirtNoise.connect(dirtFilter);
            dirtFilter.connect(dirtGain);
            dirtGain.connect(gallopMaster);
            dirtNoise.start(t);
            dirtNoise.stop(t + dirtDuration);
        });

        // === RUMBLE BASSO continuo (vibrazione del terreno sotto il cavallo) ===
        const rumbleOsc = this.ctx.createOscillator();
        const rumbleGain = this.ctx.createGain();
        rumbleOsc.type = 'sine';
        rumbleOsc.frequency.setValueAtTime(45, now);
        rumbleOsc.frequency.linearRampToValueAtTime(55, now + 0.4);
        rumbleOsc.frequency.linearRampToValueAtTime(35, now + 0.8);

        rumbleGain.gain.setValueAtTime(0.001, now);
        rumbleGain.gain.linearRampToValueAtTime(0.25, now + 0.05);
        rumbleGain.gain.setValueAtTime(0.22, now + 0.5);
        rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

        rumbleOsc.connect(rumbleGain);
        rumbleGain.connect(gallopMaster);
        rumbleOsc.start(now);
        rumbleOsc.stop(now + 0.9);
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
