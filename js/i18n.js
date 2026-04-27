const dictionary = {
    'it': {
        'chooseLanguage': 'Scegli Lingua / Choose Language',
        'rulesTitle': '📖 Regolamento: Gioco di Lucas',
        'rulesContent': `<p><strong>1. Mazzo e Giocatori:</strong> Si gioca con 40 carte. Il sistema calcola automaticamente quante carte dare e la sequenza delle mani. Le carte avanzate restano coperte nel mazzo.</p>
                <p><strong>2. Gerarchia dei Semi:</strong><br>
                    <span style="color:#f1c40f;">1. Ori (🪙)</span> > <span style="color:#3498db;">2. Spade (🗡️)</span>
                    > <span style="color:#e74c3c;">3. Coppe (🍷)</span> > <span style="color:#2ecc71;">4. Bastoni
                        (🏏)</span>.<br>
                    <em>Un seme di livello superiore batte sempre un seme di livello inferiore, anche se non è il seme
                        di uscita! (Es. Spade batte sempre Coppe)</em>
                </p>
                <p><strong>3. Forza delle Carte (nel seme):</strong><br>Asso > 3 > Re > Cavallo > Fante > 7 > 6 > 5 > 4 > 2</p>
                <p><strong>4. Regole della Presa:</strong> Se hai carte del seme di uscita devi per forza giocarla
                    ("Rispondere al seme"). Se non puoi rispondere, gioca o scarta un'altra carta. Vince la carta di
                    gerarchia maggiore del seme più alto giocato nel turno.</p>
                <p><strong>5. Sequenza delle Mani:</strong> I giri salgono a partire da 2 carte fino al limite massimo
                    (es. 10 carte a testa per 4 giocatori), dopodiché si ridiscende e torna fino a 2 carte.</p>
                <p><strong>6. Dichiarazione:</strong> Prima di giocare, dichiari quante prese pensi di fare
                    in quella fase. <em>Attenzione:</em> chi dichiara per ultimo ha il <em>"Vincolo del Mazziere"</em>,
                    ovvero il totale delle dichiarazioni di tutti non può uguagliare la quantità di carte distribuite!</p>
                <p><strong>7. Punteggio:</strong><br>
                    - Se indovini esattamente la dichiarazione, prendi <strong>+8 punti bonus</strong>.<br>
                    - Ottieni sempre <strong>+1 punto</strong> per ognuna delle prese vinte realizzate effettivamente.
                </p>
                <p><strong>8. Giro Finale Speciale (Fronte):</strong><br>Al termine di tutto c'è la finale speciale a 1
                    carta: in questo turno la tua carta apparirà coperta, mentre vedrai la carta scoperta di tutti gli
                    altri giocatori! Dichiarerai quindi alla cieca in base a cosa hanno gli altri.</p>`,
        'leaderboardTitle': '🏆 Classifica Globale',
        'rulesBtn': '📜 Regole',
        'leaderboardBtn': '🏆 Classifica',
        'exitBtn': '🚪 ESCI',
        'loginTitle': 'Accesso Account',
        'loginNicknameHolder': 'Il tuo Nickname...',
        'loginPinHolder': 'PIN 4 cifre...',
        'loginBtn': 'ACCEDI / REGISTRATI',
        'guestBtn': 'Gioca come Ospite (senza salvataggio)',
        'welcome': 'Benvenuto!',
        'createBtn': 'CREA',
        'roomCodeHolder': 'Codice',
        'joinBtn': 'ENTRA',
        'lobbyWait': 'Lobby d\'attesa',
        'roomCode': 'Codice Stanza:',
        'startGameBtn': 'AVVIA PARTITA',
        'yourBet': 'La tua dichiarazione',
        'betBtn': 'DICHIARA',
        'gameEnded': 'PARTITA FINITA!',
        'backToLobby': 'TORNA ALLA LOBBY',
        'roomLeaderboard': 'Classifica della Stanza',
        'exitToHome': 'Esci e Torna alla Home',
        'loadingLeaderboard': 'Caricamento classifica in corso...',
        'noDataLeaderboard': 'Nessun dato ancora disponibile in classifica.',
        'points': 'pt',
        'wins': 'Vinte',
        'you': 'Tu',
        'roleDealer': '(M)',
        'turn': 'Giro',
        'sum': 'Somma',
        'pts': 'Punti',
        'betLabel': 'Dich',
        'tricks': 'Prese',
        // Error Messages
        'errNickname': 'Devi inserire un Nickname!',
        'errPin': 'Devi inserire un PIN numerico di 4 cifre!',
        'errBetNumber': 'Inserisci un numero per dichiarare!',
        'errBetInvalid': 'Dichiarazione non valida! Puoi dichiarare da 0 a',
        'errDealerConstraint': '⚠️ VINCOLO MAZZIERE: Non puoi dichiarare',
        // Player Select
        'players3': '3 Giocatori',
        'players4': '4 Giocatori',
        'players5': '5 Giocatori',
        'players6': '6 Giocatori',
        'players7': '7 Giocatori',
        'players8': '8 Giocatori',
        // Bug Report
        'reportBtnTooltip': 'Segnala un Problema',
        'reportTitle': 'Segnala un Problema',
        'reportPlaceholder': 'Descrivi il problema in dettaglio...',
        'reportSubmit': 'Invia Segnalazione',
        'reportSuccess': 'Segnalazione inviata con successo! Grazie.',
        'reportEmpty': 'Il testo della segnalazione non può essere vuoto.',
        'charLimit': 'caratteri',
        'replaysBtn': '🎬 Replay',
        'replaysTitle': '🎬 Replay Partite Recenti',
        'loadingReplays': 'Caricamento replay...',
        'noReplays': 'Nessun replay disponibile.',
        'watchBtn': 'Guarda',
        'replayNext': 'Prossimo',
        'replayPrev': 'Precedente',
        'replayClose': 'Chiudi Replay',
        'interruptedMatch': 'Partita interrotta'
    },
    'en': {
        'chooseLanguage': 'Choose Language',
        'rulesTitle': '📖 Rules: Lucas Game',
        'rulesContent': `<p><strong>1. Deck and Players:</strong> Played with 40 cards. The system automatically calculates how many cards to deal and the round sequence. Remaining cards stay face down.</p>
                <p><strong>2. Suit Hierarchy:</strong><br>
                    <span style="color:#f1c40f;">1. Coins (🪙)</span> > <span style="color:#3498db;">2. Swords (🗡️)</span>
                    > <span style="color:#e74c3c;">3. Cups (🍷)</span> > <span style="color:#2ecc71;">4. Clubs
                        (🏏)</span>.<br>
                    <em>A higher-ranked suit always beats a lower-ranked suit, even if it's not the leading suit! (e.g., Swords always beat Cups)</em>
                </p>
                <p><strong>3. Card Strength:</strong><br>Ace > 3 > King > Knight > Jack > 7 > 6 > 5 > 4 > 2</p>
                <p><strong>4. Trick Rules:</strong> If you have cards of the leading suit, you must play them ("Follow suit"). If you cannot, play any other card. The highest card of the highest suit played wins.</p>
                <p><strong>5. Round Sequence:</strong> Rounds increase from 2 cards up to the max limit (e.g., 10 cards each for 4 players), then decrease back down to 2 cards.</p>
                <p><strong>6. Declaration:</strong> Before playing, you declare how many tricks you think you'll win. <em>Note:</em> the last player to declare has the <em>"Dealer's Constraint"</em>, meaning the total of all declarations cannot equal the number of cards dealt!</p>
                <p><strong>7. Scoring:</strong><br>
                    - If you exactly guess your declaration, you get <strong>+8 bonus points</strong>.<br>
                    - You always get <strong>+1 point</strong> for each trick actually won.
                </p>
                <p><strong>8. Special Final Round (Blind):</strong><br>At the very end, there's a special 1-card final: your card will be hidden from you, but you'll see everyone else's card! You will declare blindly based on what others have.</p>`,
        'leaderboardTitle': '🏆 Global Leaderboard',
        'rulesBtn': '📜 Rules',
        'leaderboardBtn': '🏆 Leaderboard',
        'exitBtn': '🚪 EXIT',
        'loginTitle': 'Account Access',
        'loginNicknameHolder': 'Your Nickname...',
        'loginPinHolder': '4 digit PIN...',
        'loginBtn': 'LOGIN / REGISTER',
        'guestBtn': 'Play as Guest (no saving)',
        'welcome': 'Welcome!',
        'createBtn': 'CREATE',
        'roomCodeHolder': 'Code',
        'joinBtn': 'JOIN',
        'lobbyWait': 'Waiting Lobby',
        'roomCode': 'Room Code:',
        'startGameBtn': 'START GAME',
        'yourBet': 'Your declaration',
        'betBtn': 'DECLARE',
        'gameEnded': 'GAME OVER!',
        'backToLobby': 'BACK TO LOBBY',
        'roomLeaderboard': 'Room Leaderboard',
        'exitToHome': 'Exit and Return Home',
        'loadingLeaderboard': 'Loading leaderboard...',
        'noDataLeaderboard': 'No data available in the leaderboard yet.',
        'points': 'pts',
        'wins': 'Wins',
        'you': 'You',
        'roleDealer': '(D)',
        'turn': 'Round',
        'sum': 'Sum',
        'pts': 'Pts',
        'betLabel': 'Decl',
        'tricks': 'Tricks',
        // Error Messages
        'errNickname': 'You must enter a Nickname!',
        'errPin': 'You must enter a 4-digit numeric PIN!',
        'errBetNumber': 'Enter a number to declare!',
        'errBetInvalid': 'Invalid declaration! You can declare from 0 to',
        'errDealerConstraint': '⚠️ DEALER CONSTRAINT: You cannot declare',
        // Player Select
        'players3': '3 Players',
        'players4': '4 Players',
        'players5': '5 Players',
        'players6': '6 Players',
        'players7': '7 Players',
        'players8': '8 Players',
        // Bug Report
        'reportBtnTooltip': 'Report a Problem',
        'reportTitle': 'Report a Problem',
        'reportPlaceholder': 'Describe the problem in detail...',
        'reportSubmit': 'Submit Report',
        'reportSuccess': 'Report submitted successfully! Thank you.',
        'reportEmpty': 'The report text cannot be empty.',
        'charLimit': 'characters',
        'replaysBtn': '🎬 Replay',
        'replaysTitle': '🎬 Recent Match Replays',
        'loadingReplays': 'Loading replays...',
        'noReplays': 'No replays available.',
        'watchBtn': 'Watch',
        'replayNext': 'Next',
        'replayPrev': 'Previous',
        'replayClose': 'Close Replay',
        'interruptedMatch': 'Interrupted match'
    },
    'fr': {
        'chooseLanguage': 'Choisissez la Langue',
        'rulesTitle': '📖 Règles : Jeu de Lucas',
        'rulesContent': `<p><strong>1. Deck et Joueurs :</strong> Joué avec 40 cartes. Le système calcule automatiquement le nombre de cartes et l'ordre des tours. Les cartes restantes restent face cachée.</p>
                <p><strong>2. Hiérarchie des Couleurs :</strong><br>
                    <span style="color:#f1c40f;">1. Deniers (🪙)</span> > <span style="color:#3498db;">2. Épées (🗡️)</span>
                    > <span style="color:#e74c3c;">3. Coupes (🍷)</span> > <span style="color:#2ecc71;">4. Bâtons
                        (🏏)</span>.<br>
                    <em>Une couleur supérieure bat toujours une couleur inférieure, même si ce n'est pas la couleur demandée ! (ex. Épées bat toujours Coupes)</em>
                </p>
                <p><strong>3. Force des Cartes :</strong><br>As > 3 > Roi > Cavalier > Valet > 7 > 6 > 5 > 4 > 2</p>
                <p><strong>4. Règles des Plis :</strong> Si vous avez des cartes de la couleur demandée, vous devez les jouer ("Fournir"). Si vous ne pouvez pas, jouez une autre carte. La plus haute carte de la plus haute couleur l'emporte.</p>
                <p><strong>5. Séquence des Tours :</strong> Les tours augmentent de 2 cartes jusqu'à la limite (ex. 10 cartes chacun pour 4 joueurs), puis redescendent jusqu'à 2 cartes.</p>
                <p><strong>6. Déclaration :</strong> Avant de jouer, vous déclarez combien de plis vous pensez gagner. <em>Attention :</em> le dernier à déclarer a la <em>"Contrainte du Donneur"</em>, le total des déclarations ne peut pas égaler le nombre de cartes distribuées !</p>
                <p><strong>7. Score :</strong><br>
                    - Si vous devinez exactement votre déclaration, vous obtenez <strong>+8 points bonus</strong>.<br>
                    - Vous obtenez toujours <strong>+1 point</strong> pour chaque pli réellement gagné.
                </p>
                <p><strong>8. Tour Final Spécial (Aveugle) :</strong><br>À la toute fin se trouve une finale à 1 carte : votre carte sera cachée, mais vous verrez celles des autres ! Vous déclarerez à l'aveugle selon les cartes des autres.</p>`,
        'leaderboardTitle': '🏆 Classement Mondial',
        'rulesBtn': '📜 Règles',
        'leaderboardBtn': '🏆 Classement',
        'exitBtn': '🚪 QUITTER',
        'loginTitle': 'Accès au Compte',
        'loginNicknameHolder': 'Votre Pseudo...',
        'loginPinHolder': 'Code PIN à 4 chiffres...',
        'loginBtn': 'CONNEXION / INSCRIPTION',
        'guestBtn': 'Jouer en tant qu\'Invité (sans sauvegarde)',
        'welcome': 'Bienvenue !',
        'createBtn': 'CRÉER',
        'roomCodeHolder': 'Code',
        'joinBtn': 'REJOINDRE',
        'lobbyWait': 'File d\'attente',
        'roomCode': 'Code de la Salle :',
        'startGameBtn': 'COMMENCER LA PARTIE',
        'yourBet': 'Votre annonce',
        'betBtn': 'ANNONCER',
        'gameEnded': 'PARTIE TERMINÉE !',
        'backToLobby': 'RETOUR AU SALON',
        'roomLeaderboard': 'Classement de la Salle',
        'exitToHome': 'Quitter et retourner à l\'Accueil',
        'loadingLeaderboard': 'Chargement du classement...',
        'noDataLeaderboard': 'Aucune donnée disponible dans le classement pour le moment.',
        'points': 'pts',
        'wins': 'Victoires',
        'you': 'Vous',
        'roleDealer': '(D)',
        'turn': 'Tour',
        'sum': 'Somme',
        'pts': 'Pts',
        'betLabel': 'Ann',
        'tricks': 'Plis',
        // Error Messages
        'errNickname': 'Vous devez entrer un Pseudo !',
        'errPin': 'Vous devez entrer un PIN numérique à 4 chiffres !',
        'errBetNumber': 'Entrez un nombre pour déclarer !',
        'errBetInvalid': 'Déclaration invalide ! Vous pouvez déclarer de 0 à',
        'errDealerConstraint': '⚠️ CONTRAINTE DU DONNEUR : Vous ne pouvez pas déclarer',
        // Player Select
        'players3': '3 Joueurs',
        'players4': '4 Joueurs',
        'players5': '5 Joueurs',
        'players6': '6 Joueurs',
        'players7': '7 Joueurs',
        'players8': '8 Joueurs',
        // Bug Report
        'reportBtnTooltip': 'Signaler un problème',
        'reportTitle': 'Signaler un problème',
        'reportPlaceholder': 'Décrivez le problème en détail...',
        'reportSubmit': 'Envoyer le rapport',
        'reportSuccess': 'Rapport envoyé avec succès ! Merci.',
        'reportEmpty': 'Le texte du rapport ne peut pas être vide.',
        'charLimit': 'caractères',
        'replaysBtn': '🎬 Replays',
        'replaysTitle': '🎬 Replays des Matchs Récents',
        'loadingReplays': 'Chargement des replays...',
        'noReplays': 'Aucun replay disponible.',
        'watchBtn': 'Regarder',
        'replayNext': 'Suivant',
        'replayPrev': 'Précédent',
        'replayClose': 'Fermer',
        'interruptedMatch': 'Match interrompu'
    },
    'es': {
        'chooseLanguage': 'Elige el Idioma',
        'rulesTitle': '📖 Reglas: Juego de Lucas',
        'rulesContent': `<p><strong>1. Baraja y Jugadores:</strong> Se juega con 40 cartas. El sistema calcula automáticamente cuántas cartas repartir y la secuencia. Las cartas sobrantes quedan boca abajo.</p>
                <p><strong>2. Jerarquía de Palos:</strong><br>
                    <span style="color:#f1c40f;">1. Oros (🪙)</span> > <span style="color:#3498db;">2. Espadas (🗡️)</span>
                    > <span style="color:#e74c3c;">3. Copas (🍷)</span> > <span style="color:#2ecc71;">4. Bastos
                        (🏏)</span>.<br>
                    <em>¡Un palo superior siempre vence a uno inferior, incluso si no es el palo de salida! (ej. Espadas siempre vence a Copas)</em>
                </p>
                <p><strong>3. Fuerza de las Cartas:</strong><br>As > 3 > Rey > Caballo > Sota > 7 > 6 > 5 > 4 > 2</p>
                <p><strong>4. Reglas de Baza:</strong> Si tienes cartas del palo de salida debes jugarlas obligatoriamente ("Asistir"). Si no puedes, juega otra carta. Gana la carta más alta del palo más alto jugado.</p>
                <p><strong>5. Secuencia de Rondas:</strong> Las rondas suben desde 2 cartas hasta el máximo (ej. 10 cartas cada uno para 4 jugadores), y luego bajan de nuevo a 2 cartas.</p>
                <p><strong>6. Declaración:</strong> Antes de jugar, declaras cuántas bazas crees que vas a ganar. <em>Atención:</em> el último en declarar tiene la <em>"Restricción del Repartidor"</em>, ¡el total de declaraciones no puede igualar la cantidad de cartas repartidas!</p>
                <p><strong>7. Puntuación:</strong><br>
                    - Si aciertas exactamente tu declaración, ganas <strong>+8 puntos extra</strong>.<br>
                    - Siempre obtienes <strong>+1 punto</strong> por cada baza ganada.
                </p>
                <p><strong>8. Ronda Final Especial (Ciega):</strong><br>Al final hay una gran final de 1 carta: tu carta estará boca abajo para ti, ¡pero verás las de los demás! Declararás a ciegas basándote en lo que tienen los demás.</p>`,
        'leaderboardTitle': '🏆 Clasificación Global',
        'rulesBtn': '📜 Reglas',
        'leaderboardBtn': '🏆 Clasificación',
        'exitBtn': '🚪 SALIR',
        'loginTitle': 'Acceso a la Cuenta',
        'loginNicknameHolder': 'Tu Apodo...',
        'loginPinHolder': 'PIN de 4 dígitos...',
        'loginBtn': 'INICIAR SESIÓN / REGISTRARSE',
        'guestBtn': 'Jugar como Invitado (sin guardar)',
        'welcome': '¡Bienvenido!',
        'createBtn': 'CREAR',
        'roomCodeHolder': 'Código',
        'joinBtn': 'UNIRSE',
        'lobbyWait': 'Sala de Espera',
        'roomCode': 'Código de la Sala:',
        'startGameBtn': 'INICIAR PARTIDA',
        'yourBet': 'Tu declaración',
        'betBtn': 'DECLARAR',
        'gameEnded': '¡PARTIDA TERMINADA!',
        'backToLobby': 'VOLVER AL VESTÍBULO',
        'roomLeaderboard': 'Clasificación de la Sala',
        'exitToHome': 'Salir y volver al Inicio',
        'loadingLeaderboard': 'Cargando clasificación...',
        'noDataLeaderboard': 'Aún no hay datos disponibles en la clasificación.',
        'points': 'pts',
        'wins': 'Ganadas',
        'you': 'Tú',
        'roleDealer': '(C)',
        'turn': 'Ronda',
        'sum': 'Suma',
        'pts': 'Pts',
        'betLabel': 'Dec',
        'tricks': 'Bazas',
        // Error Messages
        'errNickname': '¡Debes introducir un Apodo!',
        'errPin': '¡Debes introducir un PIN numérico de 4 dígitos!',
        'errBetNumber': '¡Introduce un número para declarar!',
        'errBetInvalid': '¡Declaración inválida! Puedes declarar de 0 a',
        'errDealerConstraint': '⚠️ RESTRICCIÓN DEL REPARTIDOR: ¡No puedes declarar',
        // Player Select
        'players3': '3 Jugadores',
        'players4': '4 Jugadores',
        'players5': '5 Jugadores',
        'players6': '6 Jugadores',
        'players7': '7 Jugadores',
        'players8': '8 Jugadores',
        // Bug Report
        'reportBtnTooltip': 'Reportar un problema',
        'reportTitle': 'Reportar un problema',
        'reportPlaceholder': 'Describe el problema en detalle...',
        'reportSubmit': 'Enviar informe',
        'reportSuccess': '¡Informe enviado con éxito! Gracias.',
        'reportEmpty': 'El texto del informe no puede estar vacío.',
        'charLimit': 'caracteres',
        'replaysBtn': '🎬 Replays',
        'replaysTitle': '🎬 Replays de Partidas Recientes',
        'loadingReplays': 'Cargando replays...',
        'noReplays': 'No hay replays disponibles.',
        'watchBtn': 'Ver',
        'replayNext': 'Siguiente',
        'replayPrev': 'Anterior',
        'replayClose': 'Cerrar',
        'interruptedMatch': 'Partida interrumpida'
    },
    'de': {
        'chooseLanguage': 'Sprache Wählen',
        'rulesTitle': '📖 Regeln: Lucas-Spiel',
        'rulesContent': `<p><strong>1. Deck und Spieler:</strong> Gespielt wird mit 40 Karten. Das System berechnet automatisch die Kartenanzahl und Runden. Übrige Karten bleiben verdeckt.</p>
                <p><strong>2. Farb-Hierarchie:</strong><br>
                    <span style="color:#f1c40f;">1. Münzen (🪙)</span> > <span style="color:#3498db;">2. Schwerter (🗡️)</span>
                    > <span style="color:#e74c3c;">3. Kelche (🍷)</span> > <span style="color:#2ecc71;">4. Stäbe
                        (🏏)</span>.<br>
                    <em>Eine höhere Farbe schlägt immer eine niedrigere Farbe, auch wenn es nicht die angespielte Farbe ist! (z.B. Schwerter schlagen immer Kelche)</em>
                </p>
                <p><strong>3. Kartenstärke:</strong><br>Ass > 3 > König > Pferd > Bube > 7 > 6 > 5 > 4 > 2</p>
                <p><strong>4. Stich-Regeln:</strong> Wenn du Karten der angespielten Farbe hast, musst du diese spielen ("Farbe bekennen"). Wenn nicht, spiele eine andere Karte. Die höchste Karte der höchsten Farbe gewinnt.</p>
                <p><strong>5. Runden-Ablauf:</strong> Die Runden steigen von 2 Karten bis zum Maximum (z.B. 10 Karten für 4 Spieler) und sinken dann wieder auf 2 Karten.</p>
                <p><strong>6. Ansage:</strong> Vor dem Spiel sagst du an, wie viele Stiche du machen wirst. <em>Achtung:</em> Der Letzte, der ansagt, hat den <em>"Geber-Zwang"</em>: Die Summe aller Ansagen darf nicht der Anzahl der ausgeteilten Karten entsprechen!</p>
                <p><strong>7. Punkte:</strong><br>
                    - Wenn du deine Ansage genau triffst, erhältst du <strong>+8 Bonuspunkte</strong>.<br>
                    - Du erhältst immer <strong>+1 Punkt</strong> für jeden tatsächlich gemachten Stich.
                </p>
                <p><strong>8. Spezielles Finale (Blind):</strong><br>Ganz am Ende gibt es ein Finale mit 1 Karte: Deine Karte ist für dich verdeckt, aber du siehst die Karten der anderen! Du sagst blind an, basierend darauf, was die anderen haben.</p>`,
        'leaderboardTitle': '🏆 Globale Rangliste',
        'rulesBtn': '📜 Regeln',
        'leaderboardBtn': '🏆 Rangliste',
        'exitBtn': '🚪 VERLASSEN',
        'loginTitle': 'Kontozugriff',
        'loginNicknameHolder': 'Dein Spitzname...',
        'loginPinHolder': '4-stellige PIN...',
        'loginBtn': 'ANMELDEN / REGISTRIEREN',
        'guestBtn': 'Als Gast spielen (ohne Speichern)',
        'welcome': 'Willkommen!',
        'createBtn': 'ERSTELLEN',
        'roomCodeHolder': 'Code',
        'joinBtn': 'BEITRETEN',
        'lobbyWait': 'Wartelobby',
        'roomCode': 'Raumcode:',
        'startGameBtn': 'SPIEL STARTEN',
        'yourBet': 'Deine Ansage',
        'betBtn': 'ANSAGEN',
        'gameEnded': 'SPIEL BEENDET!',
        'backToLobby': 'ZURÜCK ZUR LOBBY',
        'roomLeaderboard': 'Raum-Rangliste',
        'exitToHome': 'Beenden und zurück zur Startseite',
        'loadingLeaderboard': 'Rangliste wird geladen...',
        'noDataLeaderboard': 'Noch keine Daten in der Rangliste verfügbar.',
        'points': 'Pkt',
        'wins': 'Siege',
        'you': 'Du',
        'roleDealer': '(G)',
        'turn': 'Runde',
        'sum': 'Summe',
        'pts': 'Pkt',
        'betLabel': 'Ans',
        'tricks': 'Stiche',
        // Error Messages
        'errNickname': 'Du musst einen Spitznamen eingeben!',
        'errPin': 'Du musst eine 4-stellige numerische PIN eingeben!',
        'errBetNumber': 'Gib eine Zahl ein, um anzusagen!',
        'errBetInvalid': 'Ungültige Ansage! Du kannst ansagen von 0 bis',
        'errDealerConstraint': '⚠️ GEBER-EINSCHRÄNKUNG: Du darfst nicht ansagen:',
        // Player Select
        'players3': '3 Spieler',
        'players4': '4 Spieler',
        'players5': '5 Spieler',
        'players6': '6 Spieler',
        'players7': '7 Spieler',
        'players8': '8 Spieler',
        // Bug Report
        'reportBtnTooltip': 'Ein Problem melden',
        'reportTitle': 'Ein Problem melden',
        'reportPlaceholder': 'Beschreibe das Problem im Detail...',
        'reportSubmit': 'Bericht senden',
        'reportSuccess': 'Bericht erfolgreich gesendet! Vielen Dank.',
        'reportEmpty': 'Der Text des Berichts darf nicht leer sein.',
        'charLimit': 'Zeichen',
        'replaysBtn': '🎬 Replays',
        'replaysTitle': '🎬 Replays der letzten Spiele',
        'loadingReplays': 'Replays werden geladen...',
        'noReplays': 'Keine Replays verfügbar.',
        'watchBtn': 'Ansehen',
        'replayNext': 'Weiter',
        'replayPrev': 'Zurück',
        'replayClose': 'Schließen',
        'interruptedMatch': 'Abgebrochenes Spiel'
    }
};

export default dictionary;
