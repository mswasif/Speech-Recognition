document.addEventListener('DOMContentLoaded', () => {
    // Check for browser support
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        showError('Speech recognition is not supported in this browser. Please use Chrome.');
        return;
    }

    // Initialize Web Speech API and audio context
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    let mediaStream = null;

    // Request microphone access once at startup
    async function initializeMicrophone() {
        try {
            if (!mediaStream) {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                await setupAudioContext(mediaStream);
            }
            return true;
        } catch (error) {
            showError('Microphone access denied: ' + error.message);
            return false;
        }
    }

    // Initialize audio context for visualization
    async function setupAudioContext(stream) {
        try {
            if (!state.audioContext) {
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                state.analyser = state.audioContext.createAnalyser();
                const source = state.audioContext.createMediaStreamSource(stream);
                
                state.analyser.fftSize = 256;
                state.analyser.smoothingTimeConstant = 0.7;
                source.connect(state.analyser);
                
                state.dataArray = new Uint8Array(state.analyser.frequencyBinCount);
                
                visualizeAudio();
            }
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
        }
    }

    // Elements
    const elements = {
        startBtn: document.getElementById('startBtn'),
        stopBtn: document.getElementById('stopBtn'),
        clearBtn: document.getElementById('clearBtn'),
        copyBtn: document.getElementById('copyBtn'),
        pdfBtn: document.getElementById('pdfBtn'),
        docBtn: document.getElementById('docBtn'),
        textDisplay: document.getElementById('textDisplay'),
        status: document.getElementById('status'),
        recordingStatus: document.getElementById('recordingStatus'),
        visualizer: document.getElementById('visualizer'),
        grammarFeedback: document.getElementById('grammarFeedback'),
        languageSelect: document.getElementById('languageSelect'),
        testBtn: document.getElementById('testBtn'),
        testModePanel: document.getElementById('testModePanel'),
        testText: document.getElementById('testText'),
        accuracyFill: document.getElementById('accuracyFill'),
        accuracyValue: document.getElementById('accuracyValue'),
        pronunciationFeedback: document.getElementById('pronunciationFeedback'),
        closeTestBtn: document.getElementById('closeTestBtn'),
        wordCount: document.getElementById('wordCount'),
        browserWarning: document.getElementById('browserWarning'),
        errorModal: document.getElementById('errorModal'),
        errorMessage: document.getElementById('errorMessage'),
        closeModal: document.querySelector('.close-modal'),
        darkModeBtn: document.getElementById('darkModeBtn'),
        loadingIndicator: document.getElementById('loadingIndicator')
    };

    // Validate all elements exist
    for (const [key, element] of Object.entries(elements)) {
        if (!element) {
            console.error(`Missing element: ${key}`);
        }
    }

    const recordingDot = elements.recordingStatus.querySelector('.recording-dot');
    const recordingText = elements.recordingStatus.querySelector('.recording-text');

    let state = {
        audioContext: null,
        analyser: null,
        dataArray: null,
        finalTranscript: '',
        interimTranscript: '',
        animationId: null,
        isTestMode: false,
        currentTestText: '',
        isRecording: false,
        isDarkMode: localStorage.getItem('theme') === 'dark'
    };

    // Loading state management
    let isProcessing = false;

    function showLoading() {
        if (!isProcessing) {
            isProcessing = true;
            elements.loadingIndicator.classList.add('active');
        }
    }

    function hideLoading() {
        isProcessing = false;
        elements.loadingIndicator.classList.remove('active');
    }

    // Check browser support and show warning if needed
    function checkBrowserSupport() {
        const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
        elements.browserWarning.style.display = isChrome ? 'none' : 'block';
    }

    // Audio visualization
    function visualizeAudio() {
        if (!elements.visualizer) return;
        
        const canvasCtx = elements.visualizer.getContext('2d');
        const width = elements.visualizer.width;
        const height = elements.visualizer.height;
        let lastDrawTime = performance.now();

        function draw(currentTime) {
            if (currentTime - lastDrawTime < 16.67) {
                state.animationId = requestAnimationFrame(draw);
                return;
            }

            lastDrawTime = currentTime;
            state.animationId = requestAnimationFrame(draw);

            state.analyser.getByteFrequencyData(state.dataArray);

            canvasCtx.fillStyle = '#f5f5f5';
            canvasCtx.fillRect(0, 0, width, height);

            const barWidth = (width / state.dataArray.length) * 2.5;
            let x = 0;

            for (let i = 0; i < state.dataArray.length; i++) {
                const barHeight = state.dataArray[i] / 2;
                const gradient = canvasCtx.createLinearGradient(0, height - barHeight, 0, height);
                gradient.addColorStop(0, '#764ba2');
                gradient.addColorStop(1, '#667eea');
                canvasCtx.fillStyle = gradient;
                canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        }

        draw(performance.now());
    }

    // Speech Recognition handlers
    recognition.onstart = async () => {
        state.isRecording = true;
        elements.startBtn.disabled = true;
        elements.stopBtn.disabled = false;
        recordingDot.classList.add('recording');
        recordingText.textContent = 'Recording...';
        elements.status.textContent = 'Status: Listening...';
        hideLoading();
    };

    recognition.onresult = (event) => {
        hideLoading(); // Ensure loading is hidden during speech recognition
        state.interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                state.finalTranscript += transcript + ' ';
            } else {
                state.interimTranscript += transcript;
            }
        }

        updateDisplay();
        updateWordCount();

        // Only check grammar for final results to avoid excessive API calls
        if (state.isTestMode) {
            updateTestResults(state.finalTranscript.trim());
        } else if (event.results[event.results.length - 1].isFinal) {
            checkGrammar(state.finalTranscript, recognition.lang);
        }
    };

    recognition.onend = () => {
        state.isRecording = false;
        elements.startBtn.disabled = false;
        elements.stopBtn.disabled = true;
        recordingDot.classList.remove('recording');
        recordingText.textContent = 'Not Recording';
        elements.status.textContent = 'Status: Ready';

        if (state.audioContext) {
            cancelAnimationFrame(state.animationId);
            state.audioContext.close();
            state.audioContext = null;
        }
    };

    recognition.onerror = (event) => {
        showError('Error occurred in recognition: ' + event.error);
        elements.startBtn.disabled = false;
        elements.stopBtn.disabled = true;
    };

    // Button click handlers with faster response
    elements.startBtn.addEventListener('click', async () => {
        try {
            // Request microphone access first
            const micAllowed = await initializeMicrophone();
            if (!micAllowed) return;

            recognition.lang = elements.languageSelect.value;
            recognition.start();
            elements.grammarFeedback.innerHTML = '';
            elements.grammarFeedback.classList.remove('active');
            hideLoading();
        } catch (error) {
            showError('Failed to start recognition: ' + error.message);
        }
    });

    elements.stopBtn.addEventListener('click', () => {
        recognition.stop();
        hideLoading();
    });

    elements.clearBtn.addEventListener('click', () => {
        state.finalTranscript = '';
        state.interimTranscript = '';
        updateDisplay();
        updateWordCount();
        elements.grammarFeedback.classList.remove('active');
    });

    elements.copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(state.finalTranscript)
            .then(() => elements.status.textContent = 'Status: Text copied to clipboard!')
            .catch(error => showError('Failed to copy text: ' + error.message));
    });

    // PDF Download
    elements.pdfBtn.addEventListener('click', async () => {
        showLoading();
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            const text = elements.textDisplay.innerText;
            const selectedLang = elements.languageSelect.value;
            const langName = elements.languageSelect.options[elements.languageSelect.selectedIndex].text;
            
            // Set font for different languages
            if (selectedLang.startsWith('ar') || selectedLang === 'ur-PK') {
                doc.setFont('Arial', 'normal');
                // For RTL languages, reverse the text
                doc.text(text.split('').reverse().join(''), 190, 10, { align: 'right' });
            } else if (selectedLang.startsWith('zh') || selectedLang === 'ja-JP' || selectedLang === 'ko-KR') {
                doc.setFont('Arial', 'normal');
                doc.text(text, 10, 10);
            } else {
                doc.setFont('helvetica', 'normal');
                doc.text(text, 10, 10);
            }
            
            const filename = `speech_text_${langName}_${new Date().toISOString().slice(0,10)}.pdf`;
            doc.save(filename);
        } catch (error) {
            showError('Failed to generate PDF: ' + error.message);
        } finally {
            hideLoading();
        }
    });

    // DOC Download
    elements.docBtn.addEventListener('click', async () => {
        showLoading();
        try {
            const text = elements.textDisplay.innerText;
            const selectedLang = elements.languageSelect.value;
            
            // Create a new Blob with the text content
            const blob = new Blob([text], { type: 'application/msword;charset=utf-8' });
            
            // Create a filename with the language code
            const langName = elements.languageSelect.options[elements.languageSelect.selectedIndex].text;
            const filename = `speech_text_${langName}_${new Date().toISOString().slice(0,10)}.doc`;
            
            // Use the saveAs function from FileSaver.js
            if (typeof saveAs !== 'function') {
                throw new Error('FileSaver.js is not properly loaded');
            }
            
            saveAs(blob, filename);
        } catch (error) {
            showError('Failed to generate DOC: ' + error.message);
        } finally {
            hideLoading();
        }
    });

    // Test mode handlers
    elements.testBtn.addEventListener('click', () => {
        state.isTestMode = !state.isTestMode;
        elements.testModePanel.style.display = state.isTestMode ? 'block' : 'none';
        if (state.isTestMode) {
            setRandomTestText();
        }
    });

    elements.closeTestBtn.addEventListener('click', () => {
        state.isTestMode = false;
        elements.testModePanel.style.display = 'none';
    });

    // Error modal handlers
    elements.closeModal.addEventListener('click', () => {
        elements.errorModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target === elements.errorModal) {
            elements.errorModal.style.display = 'none';
        }
    });

    // Language selection handler
    elements.languageSelect.addEventListener('change', () => {
        recognition.lang = elements.languageSelect.value;
        if (state.isTestMode) {
            setRandomTestText();
        }
    });

    // Dark mode toggle
    elements.darkModeBtn.addEventListener('click', () => {
        state.isDarkMode = !state.isDarkMode;
        document.body.classList.toggle('dark-mode', state.isDarkMode);
        localStorage.setItem('theme', state.isDarkMode ? 'dark' : 'light');
        elements.darkModeBtn.innerHTML = state.isDarkMode ? 
            '<i class="fas fa-sun"></i>' : 
            '<i class="fas fa-moon"></i>';
    });

    // Helper functions
    function showError(message) {
        console.error(message); // Log error for debugging
        elements.errorMessage.textContent = message;
        elements.errorModal.style.display = 'block';
    }

    function updateDisplay() {
        elements.textDisplay.innerHTML = `
            <p>${state.finalTranscript}</p>
            <p><i>${state.interimTranscript}</i></p>
        `;
    }

    function updateWordCount() {
        const words = state.finalTranscript.trim().split(/\s+/).filter(word => word.length > 0);
        elements.wordCount.textContent = `Words: ${words.length}`;
    }

    function setRandomTestText() {
        const texts = testTexts[elements.languageSelect.value] || testTexts['en-US'];
        state.currentTestText = texts[Math.floor(Math.random() * texts.length)];
        elements.testText.textContent = state.currentTestText;
        resetTestResults();
    }

    function resetTestResults() {
        elements.accuracyFill.style.width = '0%';
        elements.accuracyValue.textContent = '0%';
        elements.pronunciationFeedback.textContent = '';
    }

    function calculateAccuracy(spoken, target) {
        const spokenWords = spoken.toLowerCase().split(/\s+/);
        const targetWords = target.toLowerCase().split(/\s+/);
        let correctWords = 0;

        spokenWords.forEach((word, index) => {
            if (index < targetWords.length && word === targetWords[index]) {
                correctWords++;
            }
        });

        return Math.round((correctWords / targetWords.length) * 100);
    }

    function updateTestResults(spokenText) {
        const accuracy = calculateAccuracy(spokenText, state.currentTestText);
        elements.accuracyFill.style.width = `${accuracy}%`;
        elements.accuracyValue.textContent = `${accuracy}%`;

        let feedback = '';
        if (accuracy >= 90) {
            feedback = 'Excellent pronunciation! Keep it up! ';
        } else if (accuracy >= 70) {
            feedback = 'Good job! Try to speak a bit more clearly. ';
        } else {
            feedback = 'Keep practicing! Focus on speaking slowly and clearly. ';
        }
        elements.pronunciationFeedback.textContent = feedback;
    }

    async function checkGrammar(text, language) {
        if (!text.trim()) return;

        try {
            showLoading();
            const response = await fetch('https://api.languagetool.org/v2/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `text=${encodeURIComponent(text)}&language=${language.split('-')[0]}`
            });

            if (!response.ok) throw new Error('Grammar check failed');

            const data = await response.json();
            updateGrammarFeedback(data.matches);
        } catch (error) {
            console.error('Grammar check error:', error);
            // Don't show error to user as grammar check is optional
        } finally {
            hideLoading();
        }
    }

    function updateGrammarFeedback(matches) {
        if (!matches || matches.length === 0) {
            elements.grammarFeedback.classList.remove('active');
            return;
        }

        elements.grammarFeedback.innerHTML = '';
        elements.grammarFeedback.classList.add('active');

        matches.forEach(match => {
            const error = document.createElement('div');
            error.className = 'grammar-error';
            error.innerHTML = `
                <strong>Issue:</strong> ${match.message}<br>
                <strong>Suggestion:</strong> ${match.replacements[0]?.value || 'No suggestion available'}
            `;
            elements.grammarFeedback.appendChild(error);
        });
    }

    // Test texts in different languages
    const testTexts = {
        'en-US': [
            "The quick brown fox jumps over the lazy dog.",
            "She sells seashells by the seashore.",
            "How much wood would a woodchuck chuck if a woodchuck could chuck wood?"
        ],
        'es-ES': [
            "El rápido zorro marrón salta sobre el perro perezoso.",
            "Tres tristes tigres tragan trigo en un trigal.",
            "Pablito clavó un clavito en la calva de un calvito."
        ]
    };

    // Initialize
    checkBrowserSupport();
    recognition.lang = elements.languageSelect.value;

    // Handle page visibility
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && state.isRecording) {
            recognition.stop();
        }
    });

    // Cleanup function for when the page is closed
    window.addEventListener('beforeunload', () => {
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
        }
        if (state.audioContext) {
            state.audioContext.close();
        }
    });
});
