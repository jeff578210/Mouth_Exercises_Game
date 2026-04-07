// js/mode_voice.js
import { currentVrm, currentTrainingMode, isGameRunning, isTutorialLocked, gameStats, poseQueue, triggerResult ,currentDifficulty } from './app.js';
// 🛑 核心修復 1：匯入嘴型模式的辨識器，用來把它強制關閉
import { analyser, dataArray, isMicEnabled, recognitionMouth } from './mode_mouth.js';

let isDetecting = false;
let currentTargetSyllable = "PA";
let remainingHits = 5;
let hitCooldown = false; 
let recognition = null;

// 📖 擴充同音字字典：把所有可能的短促音或雜訊字都放進來
const SYLLABLE_MAP = {
    "PA": ["pa", "趴", "怕", "啪", "叭", "吧", "巴", "把", "爸", "發", "爬", "帕", "哈", "八", "拔", "潘", "判", "旁", "胖", "派", "拍", "阿", "啊"],
    "TA": ["ta", "他", "她", "它", "踏", "塔", "大", "打", "答", "達", "太", "探", "塌", "沓", "特", "搭", "代"],
    "KA": ["ka", "卡", "喀", "咖", "咔", "嘎", "尬", "ga", "擦", "哈", "看", "ㄎ", "可", "克", "客", "渴", "考", "靠"],
    "LA": ["la", "拉", "啦", "喇", "辣", "拿", "哪", "納", "藍", "落", "來", "哩", "了", "老", "na", "那", "男"]
};

export async function initVoiceMode() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'zh-TW';
        recognition.onresult = (event) => {
            if (!isDetecting || !isGameRunning || isTutorialLocked || hitCooldown) return;
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript.toLowerCase();
                console.log(`[發聲辨識] 聽到: "${transcript}"`); 
                
                const validWords = SYLLABLE_MAP[currentTargetSyllable];
                if (validWords && validWords.some(word => transcript.includes(word))) {
                    console.log(`🎯 命中目標音: ${currentTargetSyllable}!`);
                    triggerStoneHit();
                    try { recognition.stop(); } catch(e){}
                    break; 
                }
            }
        };

        recognition.onend = () => {
            if (isDetecting && isGameRunning) {
                try { recognition.start(); } catch(e){}
            }
        };
    }
}

export function startVoiceDetection() {
    if (isDetecting) return;
    isDetecting = true;
    
    // 🛑 核心修復 2：搶奪麥克風！強制停止嘴型模式的辨識器
    if (recognitionMouth) {
        try { recognitionMouth.stop(); } catch(e){}
    }

    if (recognition) {
        try { recognition.stop(); } catch(e){}
        setTimeout(() => { try { recognition.start(); } catch(e){} }, 100);
    }
    spawnVoiceTask();
    predictLoop();
}

export function stopVoiceDetection() {
    isDetecting = false;
    if (recognition) { try { recognition.stop(); } catch(e){} }
}

function spawnVoiceTask() {
    if (poseQueue.length === 0) return;
    
    currentTargetSyllable = poseQueue[0];
    remainingHits = (isTutorialLocked) ? 1 : 2;

    const stone = document.getElementById("stone-container");
    const text = document.getElementById("stone-text");
    const hp = document.getElementById("stone-hp");
    
    if (stone) {
        stone.className = ""; 
        text.innerText = currentTargetSyllable;
        hp.innerText = `剩餘 ${remainingHits} 次`;
    }

    // 🌟 核心修改：只有「教學模式」才唸出指令
    if (currentDifficulty === "tutorial") {
        window.speechSynthesis.cancel();
        let msg = `大聲喊出 ${currentTargetSyllable}`;
        const utterance = new SpeechSynthesisUtterance(msg);
        utterance.lang = "zh-TW";

        if (isTutorialLocked) {
            if (stone) stone.style.opacity = "0.5"; 
            utterance.onend = () => { if (stone) stone.style.opacity = "1"; };
        }
        window.speechSynthesis.speak(utterance);
    } else {
        // 非教學模式：不唸指令，直接確保石頭是亮的
        window.speechSynthesis.cancel();
        if (stone) stone.style.opacity = "1";
    }
}

function predictLoop() {
    if (!isDetecting || currentTrainingMode !== 'voice') {
        requestAnimationFrame(predictLoop);
        return;
    }

    if (isMicEnabled && analyser) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        let currentVolume = sum / dataArray.length;

        // 🌟 核心修復 3：改抓正確的 ID `meter-fill`
        const meterFill = document.getElementById("meter-fill");
        if (meterFill) {
            meterFill.style.width = Math.min((currentVolume / 80) * 100, 100) + "%";
            meterFill.style.backgroundColor = "#e74c3c"; // 發聲模式專屬的紅色音量條
        }

        if (currentVrm) {
            currentVrm.expressionManager.setValue('aa', Math.min(currentVolume / 40, 1.0));
        }
    }
    requestAnimationFrame(predictLoop);
}

function triggerStoneHit() {
    hitCooldown = true;
    remainingHits--;
    
    const stone = document.getElementById("stone-container");
    const hp = document.getElementById("stone-hp");

    if (remainingHits > 0) {
        stone.classList.add("stone-hit");
        setTimeout(() => { stone.classList.remove("stone-hit"); hitCooldown = false; }, 400);
        hp.innerText = `剩餘 ${remainingHits} 次`;
    } else {
        stone.classList.add("stone-explode");
        if (gameStats && gameStats[currentTargetSyllable]) gameStats[currentTargetSyllable].success++;
        
        setTimeout(() => {
            triggerResult(true); 
            hitCooldown = false;
            if (isGameRunning) spawnVoiceTask(); 
        }, 1000);
    }
}