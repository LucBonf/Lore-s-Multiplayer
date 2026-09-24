/**
 * LORES / LUCAS GAME - VOICE CHAT ENGINE (WebRTC P2P Mesh)
 * Comunicazione vocale cifrata browser-to-browser.
 * Zero registrazione, zero archiviazione server, codec Opus ad alta fedeltà.
 */

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Server TURN gratuiti come fallback per connessioni dietro NAT simmetrico
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceCandidatePoolSize: 2
};

// Soglia di volume RMS per il rilevamento voce (0-255 su scala frequenza)
const VAD_THRESHOLD = 14;

// Intervallo di polling VAD in ms
const VAD_POLL_INTERVAL = 100;

// Debounce per speaking remoto (ms) — evita flickering animazione
const REMOTE_SPEAKING_DEBOUNCE = 200;

// Throttle minimo tra invii voice_state al server (ms)
const SPEAKING_EMIT_THROTTLE = 250;

class VoiceChatManager {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peers = new Map(); // peerId -> { pc, audio, analyser, dataArray, iceCandidateQueue, remoteDescriptionSet, lastSpeaking, lastSpeakingTime }
        this.isEnabled = false;
        this.isMuted = false;
        this.isDeafened = false;
        this.audioCtx = null;
        this.localAnalyser = null;
        this.localDataArray = null;
        this.vadInterval = null;
        this.lastSpeakingState = false;
        this.speakingThrottle = 0;
        this._pendingSpeakingEmit = null; // Timer per garantire l'invio dell'ultimo stato

        // Callback per notificare l'interfaccia
        this.onStateChange = null;
        this.onSpeakingChange = null;
    }

    isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
    }

    init(socket) {
        if (this.socket) return;
        this.socket = socket;
        this._setupSocketListeners();
    }

    _setupSocketListeners() {
        if (!this.socket) return;

        // Riceviamo la lista dei peer già presenti nella voice room
        this.socket.on('voice_peers_list', async (peerIds) => {
            if (!this.isEnabled || !this.localStream) return;
            for (const peerId of peerIds) {
                // Essendo noi i nuovi arrivati, creiamo l'offerta per ciascun peer
                await this._createPeerConnection(peerId, true);
            }
        });

        // Un nuovo peer si è connesso: prepariamo la connessione (aspettiamo la sua offerta)
        // Il nuovo arrivato crea le offerte tramite voice_peers_list, noi rispondiamo via voice_signal
        this.socket.on('voice_peer_joined', async ({ peerId }) => {
            if (!this.isEnabled || !this.localStream) return;
            // Pre-creiamo la peer connection in attesa della sua offerta SDP
            // In questo modo i candidati ICE che arrivano prima dell'offerta vengono correttamente accodati
            if (!this.peers.has(peerId)) {
                await this._createPeerConnection(peerId, false);
            }
        });

        // Segnali WebRTC in arrivo (offer, answer, candidate)
        this.socket.on('voice_signal', async ({ from, signal }) => {
            if (!this.isEnabled || !this.localStream) return;
            try {
                await this._handleSignal(from, signal);
            } catch (err) {
                console.error("Errore gestione segnale da", from, err);
            }
        });

        // Stato muto/speaking di un peer remoto
        this.socket.on('voice_peer_state', ({ peerId, isMuted, isSpeaking }) => {
            if (this.onSpeakingChange) {
                this.onSpeakingChange(peerId, isSpeaking && !isMuted);
            }
        });

        // Un peer ha lasciato la chat vocale
        this.socket.on('voice_peer_left', ({ peerId }) => {
            this._removePeer(peerId);
        });
    }

    async toggleVoice() {
        if (this.isEnabled) {
            this.leaveVoice();
            return false;
        } else {
            return await this.startVoice();
        }
    }

    async startVoice() {
        if (!this.isSupported()) {
            alert("Il tuo browser non supporta WebRTC per la chat vocale.");
            return false;
        }

        try {
            // Richiesta accesso al microfono con ottimizzazioni per la voce
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            this.isEnabled = true;
            this.isMuted = false;
            this.isDeafened = false;

            // Inizializza l'analizzatore di volume locale per la Voice Activity Detection (VAD)
            this._initLocalAnalyser();

            // Notifichiamo al server l'ingresso nella voice room
            if (this.socket) {
                this.socket.emit('voice_join');
            }

            this._notifyState();
            return true;
        } catch (err) {
            console.error("Accesso microfono negato o non disponibile:", err);
            this.leaveVoice();
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert("Permesso microfono non concesso. Abilita il microfono nelle impostazioni del browser per usare la chat vocale.");
            } else {
                alert("Impossibile accedere al microfono: " + err.message);
            }
            return false;
        }
    }

    toggleMute() {
        if (!this.isEnabled || !this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });

        if (this.socket) {
            this.socket.emit('voice_state', { isMuted: this.isMuted, isSpeaking: false });
        }

        if (this.onSpeakingChange) {
            this.onSpeakingChange('me', false);
        }

        this._notifyState();
        return this.isMuted;
    }

    toggleDeafen() {
        if (!this.isEnabled) return false;
        this.isDeafened = !this.isDeafened;

        for (const peerData of this.peers.values()) {
            if (peerData.audio) {
                peerData.audio.muted = this.isDeafened;
            }
        }

        this._notifyState();
        return this.isDeafened;
    }

    leaveVoice() {
        // Ferma timer pendente di speaking
        if (this._pendingSpeakingEmit) {
            clearTimeout(this._pendingSpeakingEmit);
            this._pendingSpeakingEmit = null;
        }

        // Ferma i track locali
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Chiude tutte le connessioni peer
        for (const peerId of Array.from(this.peers.keys())) {
            this._removePeer(peerId);
        }

        // Ferma l'analizzatore VAD
        if (this.vadInterval) {
            clearInterval(this.vadInterval);
            this.vadInterval = null;
        }

        // Chiude AudioContext (rilascio risorse hardware)
        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            try { this.audioCtx.close(); } catch (e) {}
            this.audioCtx = null;
        }

        this.localAnalyser = null;
        this.localDataArray = null;

        if (this.socket && this.isEnabled) {
            this.socket.emit('voice_leave');
        }

        this.isEnabled = false;
        this.isMuted = false;
        this.isDeafened = false;
        this.lastSpeakingState = false;

        if (this.onSpeakingChange) {
            this.onSpeakingChange('me', false);
        }

        this._notifyState();
    }

    async _createPeerConnection(peerId, isInitiator) {
        // Se la connessione esiste già ed è ancora attiva, riusala
        if (this.peers.has(peerId)) {
            const existing = this.peers.get(peerId);
            if (existing.pc && existing.pc.connectionState !== 'failed' && existing.pc.connectionState !== 'closed') {
                return existing.pc;
            }
            // Connessione in stato invalido, la rimuoviamo per ricrearla
            this._removePeer(peerId);
        }

        const pc = new RTCPeerConnection(ICE_SERVERS);
        const peerData = {
            pc,
            audio: null,
            analyser: null,
            dataArray: null,
            iceCandidateQueue: [],           // Coda per candidati ICE arrivati prima di remoteDescription
            remoteDescriptionSet: false,     // Flag che indica se setRemoteDescription è stato chiamato
            lastSpeaking: false,             // Ultimo stato speaking rilevato (per debounce)
            lastSpeakingTime: 0              // Timestamp ultimo cambio stato speaking
        };
        this.peers.set(peerId, peerData);

        // Aggiungiamo i track locali al peer
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Invio dei candidati ICE al peer remoto tramite signaling
        pc.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                this.socket.emit('voice_signal', {
                    to: peerId,
                    signal: { candidate: event.candidate }
                });
            }
        };

        // Ricezione dello stream audio remoto
        pc.ontrack = (event) => {
            console.log(`[Voice] ontrack ricevuto da ${peerId}, streams: ${event.streams.length}, track kind: ${event.track.kind}`);
            const remoteStream = event.streams[0];
            if (!remoteStream) {
                console.warn(`[Voice] ontrack senza stream da ${peerId}`);
                return;
            }

            let audioEl = peerData.audio;
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                audioEl.playsInline = true;
                audioEl.volume = 1.0;
                // Stile nascosto ma presente nel DOM
                audioEl.style.position = 'absolute';
                audioEl.style.opacity = '0';
                audioEl.style.pointerEvents = 'none';
                document.body.appendChild(audioEl);
                peerData.audio = audioEl;
            }
            audioEl.srcObject = remoteStream;
            audioEl.muted = this.isDeafened;

            // Forza il play (necessario per policy autoplay di alcuni browser)
            const playPromise = audioEl.play();
            if (playPromise) {
                playPromise.catch(e => {
                    console.warn(`[Voice] Autoplay bloccato per ${peerId}, tentativo dopo user gesture:`, e);
                    // Riprova al prossimo click dell'utente
                    const resumePlay = () => {
                        audioEl.play().catch(() => {});
                        document.removeEventListener('click', resumePlay);
                        document.removeEventListener('touchstart', resumePlay);
                    };
                    document.addEventListener('click', resumePlay, { once: true });
                    document.addEventListener('touchstart', resumePlay, { once: true });
                });
            }

            // Collega l'analizzatore audio per monitorare chi parla
            // Usa un clone dello stream per non interferire con la riproduzione dell'elemento <audio>
            this._attachRemoteAnalyser(peerId, remoteStream);
        };

        // Gestione cambio stato connessione con riconnessione automatica
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            console.log(`[Voice] connectionState con ${peerId}: ${state}`);
            if (state === 'connected') {
                console.log(`[Voice] ✅ Connessione P2P stabilita con ${peerId}`);
            } else if (state === 'failed') {
                // Tentativo di ICE restart prima di rimuovere il peer
                console.warn(`[Voice] ❌ Connessione fallita con ${peerId}, tentativo ICE restart...`);
                this._attemptIceRestart(peerId);
            } else if (state === 'disconnected') {
                // Potrebbe essere un'interruzione temporanea; aspettiamo prima di rimuovere
                console.warn(`[Voice] ⚠️ Peer ${peerId} disconnesso, attendo 5s...`);
                setTimeout(() => {
                    const pd = this.peers.get(peerId);
                    if (pd && pd.pc && pd.pc.connectionState === 'disconnected') {
                        console.warn(`[Voice] Peer ${peerId} ancora disconnesso dopo timeout, tentativo ICE restart...`);
                        this._attemptIceRestart(peerId);
                    }
                }, 5000);
            } else if (state === 'closed') {
                this._removePeer(peerId);
            }
        };

        // Log dettagliato sullo stato ICE gathering
        pc.onicegatheringstatechange = () => {
            console.log(`[Voice] ICE gathering state con ${peerId}: ${pc.iceGatheringState}`);
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`[Voice] ICE connection state con ${peerId}: ${pc.iceConnectionState}`);
        };

        // Se siamo l'iniziatore, creiamo e inviamo l'offerta SDP
        if (isInitiator) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (this.socket) {
                    this.socket.emit('voice_signal', {
                        to: peerId,
                        signal: { sdp: pc.localDescription }
                    });
                }
            } catch (err) {
                console.error("Errore creazione offerta SDP per", peerId, err);
            }
        }

        this._notifyState();
        return pc;
    }

    async _attemptIceRestart(peerId) {
        const peerData = this.peers.get(peerId);
        if (!peerData || !peerData.pc) return;

        try {
            const pc = peerData.pc;
            if (pc.connectionState === 'closed') {
                this._removePeer(peerId);
                return;
            }
            // Reset candidati e flag per il nuovo ciclo ICE
            peerData.iceCandidateQueue = [];
            peerData.remoteDescriptionSet = false;

            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            if (this.socket) {
                this.socket.emit('voice_signal', {
                    to: peerId,
                    signal: { sdp: pc.localDescription }
                });
            }
        } catch (err) {
            console.error("ICE restart fallito per", peerId, err);
            this._removePeer(peerId);
        }
    }

    async _handleSignal(peerId, signal) {
        let peerData = this.peers.get(peerId);
        let pc = peerData?.pc;

        if (signal.sdp) {
            const sdp = signal.sdp;
            if (sdp.type === 'offer') {
                if (!pc) {
                    pc = await this._createPeerConnection(peerId, false);
                    peerData = this.peers.get(peerId);
                }
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                peerData.remoteDescriptionSet = true;

                // Processa eventuali candidati ICE arrivati prima del setRemoteDescription
                await this._flushIceCandidateQueue(peerId);

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                if (this.socket) {
                    this.socket.emit('voice_signal', {
                        to: peerId,
                        signal: { sdp: pc.localDescription }
                    });
                }
            } else if (sdp.type === 'answer') {
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    if (peerData) {
                        peerData.remoteDescriptionSet = true;
                        // Processa eventuali candidati ICE arrivati prima dell'answer
                        await this._flushIceCandidateQueue(peerId);
                    }
                }
            }
        } else if (signal.candidate) {
            if (!pc) {
                // Il peer non esiste ancora; creiamolo e accodiamo il candidato
                pc = await this._createPeerConnection(peerId, false);
                peerData = this.peers.get(peerId);
            }
            if (peerData && !peerData.remoteDescriptionSet) {
                // Remote description non ancora impostata: accodiamo il candidato ICE
                peerData.iceCandidateQueue.push(signal.candidate);
            } else if (pc) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                } catch (e) {
                    console.warn("Errore aggiunta ICE candidate:", e);
                }
            }
        }
    }

    /**
     * Processa i candidati ICE in coda (arrivati prima di setRemoteDescription)
     */
    async _flushIceCandidateQueue(peerId) {
        const peerData = this.peers.get(peerId);
        if (!peerData || !peerData.pc || peerData.iceCandidateQueue.length === 0) return;

        const queue = peerData.iceCandidateQueue;
        peerData.iceCandidateQueue = [];

        for (const candidate of queue) {
            try {
                await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.warn("Errore aggiunta ICE candidate dalla coda:", e);
            }
        }
    }

    _removePeer(peerId) {
        const peerData = this.peers.get(peerId);
        if (!peerData) return;

        try {
            if (peerData.pc) {
                // Rimuovi tutti gli event handler per evitare callback post-chiusura
                peerData.pc.onicecandidate = null;
                peerData.pc.ontrack = null;
                peerData.pc.onconnectionstatechange = null;
                peerData.pc.onicegatheringstatechange = null;
                peerData.pc.oniceconnectionstatechange = null;
                peerData.pc.close();
            }
            if (peerData.audio) {
                peerData.audio.pause();
                peerData.audio.srcObject = null;
                peerData.audio.remove();
            }
            // Ferma lo stream clonato dell'analizzatore
            if (peerData.analyserStream) {
                peerData.analyserStream.getTracks().forEach(t => t.stop());
            }
        } catch (e) {}

        this.peers.delete(peerId);

        if (this.onSpeakingChange) {
            this.onSpeakingChange(peerId, false);
        }

        this._notifyState();
        console.log(`[Voice] Peer ${peerId} rimosso`);
    }

    _initLocalAnalyser() {
        if (!this.localStream) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!this.audioCtx) this.audioCtx = new AudioCtx();

            // Riprendi AudioContext se sospeso (policy autoplay dei browser)
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }

            const source = this.audioCtx.createMediaStreamSource(this.localStream);
            this.localAnalyser = this.audioCtx.createAnalyser();
            this.localAnalyser.fftSize = 256;
            this.localAnalyser.smoothingTimeConstant = 0.5; // Liscia i valori per ridurre jitter
            source.connect(this.localAnalyser);

            this.localDataArray = new Uint8Array(this.localAnalyser.frequencyBinCount);

            // Avvia il loop di rilevamento attività vocale (VAD)
            if (!this.vadInterval) {
                this.vadInterval = setInterval(() => this._checkVoiceActivity(), VAD_POLL_INTERVAL);
            }
        } catch (e) {
            console.warn("Impossibile avviare analizzatore vocale locale:", e);
        }
    }

    _attachRemoteAnalyser(peerId, stream) {
        try {
            if (!this.audioCtx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) this.audioCtx = new AudioCtx();
            }
            if (!this.audioCtx) return;

            // Riprendi AudioContext se sospeso (policy autoplay dei browser)
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }

            const peerData = this.peers.get(peerId);
            if (!peerData) return;

            // IMPORTANTE: Cloniamo lo stream per l'analisi.
            // Usare createMediaStreamSource sullo stesso stream collegato a un <audio>
            // può causare problemi di routing audio in alcuni browser (Chrome/Safari)
            // dove l'audio smette di uscire dall'elemento <audio>.
            const clonedStream = stream.clone();
            const source = this.audioCtx.createMediaStreamSource(clonedStream);
            const analyser = this.audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.5; // Liscia i valori per ridurre jitter
            source.connect(analyser);
            // NON colleghiamo alla destinazione: l'analyser è solo per VAD,
            // la riproduzione avviene tramite l'elemento <audio>

            peerData.analyser = analyser;
            peerData.dataArray = new Uint8Array(analyser.frequencyBinCount);
            // Salviamo il clone per poterlo fermare quando rimuoviamo il peer
            peerData.analyserStream = clonedStream;

            console.log(`[Voice] Analizzatore remoto collegato per ${peerId}`);
        } catch (e) {
            console.warn("[Voice] Impossibile collegare analizzatore remoto:", e);
        }
    }

    _checkVoiceActivity() {
        const now = Date.now();

        // 1. Controllo locale (me)
        if (this.localAnalyser && this.localDataArray && !this.isMuted && this.isEnabled) {
            this.localAnalyser.getByteFrequencyData(this.localDataArray);
            let sum = 0;
            for (let i = 0; i < this.localDataArray.length; i++) {
                sum += this.localDataArray[i];
            }
            const average = sum / this.localDataArray.length;
            const isSpeaking = average > VAD_THRESHOLD;

            if (isSpeaking !== this.lastSpeakingState) {
                this.lastSpeakingState = isSpeaking;
                if (this.onSpeakingChange) {
                    this.onSpeakingChange('me', isSpeaking);
                }
                // Invia lo stato al server con throttle, ma garantisci l'ultimo aggiornamento
                this._emitSpeakingStateThrottled(isSpeaking, now);
            }
        }

        // 2. Controllo peer remoti (con debounce per evitare flickering dell'animazione)
        for (const [peerId, peerData] of this.peers.entries()) {
            if (peerData.analyser && peerData.dataArray) {
                peerData.analyser.getByteFrequencyData(peerData.dataArray);
                let sum = 0;
                for (let i = 0; i < peerData.dataArray.length; i++) {
                    sum += peerData.dataArray[i];
                }
                const average = sum / peerData.dataArray.length;
                const isSpeaking = average > VAD_THRESHOLD;

                // Debounce: aggiorna l'UI solo se lo stato è cambiato E è passato abbastanza tempo
                const prevSpeaking = peerData.lastSpeaking || false;
                if (isSpeaking !== prevSpeaking) {
                    const timeSinceLastChange = now - (peerData.lastSpeakingTime || 0);
                    if (timeSinceLastChange >= REMOTE_SPEAKING_DEBOUNCE) {
                        peerData.lastSpeaking = isSpeaking;
                        peerData.lastSpeakingTime = now;
                        if (this.onSpeakingChange) {
                            this.onSpeakingChange(peerId, isSpeaking);
                        }
                    }
                }
            }
        }
    }

    /**
     * Invio throttled dello stato speaking al server.
     * Garantisce che l'ultimo cambiamento di stato venga sempre inviato,
     * anche se cade durante il periodo di throttle.
     */
    _emitSpeakingStateThrottled(isSpeaking, now) {
        // Cancella eventuali invii pendenti
        if (this._pendingSpeakingEmit) {
            clearTimeout(this._pendingSpeakingEmit);
            this._pendingSpeakingEmit = null;
        }

        if (now - this.speakingThrottle >= SPEAKING_EMIT_THROTTLE) {
            // Possiamo inviare subito
            this.speakingThrottle = now;
            if (this.socket) {
                this.socket.emit('voice_state', { isMuted: false, isSpeaking: isSpeaking });
            }
        } else {
            // Programmiamo l'invio per quando il throttle scade (garantisce ultimo stato)
            const remaining = SPEAKING_EMIT_THROTTLE - (now - this.speakingThrottle);
            this._pendingSpeakingEmit = setTimeout(() => {
                this._pendingSpeakingEmit = null;
                this.speakingThrottle = Date.now();
                if (this.socket && this.isEnabled) {
                    this.socket.emit('voice_state', { isMuted: this.isMuted, isSpeaking: this.lastSpeakingState });
                }
            }, remaining);
        }
    }

    _notifyState() {
        if (this.onStateChange) {
            this.onStateChange({
                isEnabled: this.isEnabled,
                isMuted: this.isMuted,
                isDeafened: this.isDeafened,
                peersCount: this.peers.size
            });
        }
    }
}

// Istanza singleton esportata
const voiceManager = new VoiceChatManager();
export default voiceManager;
