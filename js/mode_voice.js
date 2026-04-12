// js/mode_voice.js
import { currentVrm, currentTrainingMode, isGameRunning, isTutorialLocked, gameStats, poseQueue, triggerResult ,currentDifficulty ,renderBelt,handleTranscript} from './app.js';
import { analyser, dataArray, isMicEnabled, recognitionMouth } from './mode_mouth.js';

let isDetecting = false; //檢查遊戲有沒有再進行
let currentTargetSyllable; //當前題目
let hitCooldown = false; //防止連擊
let recognition = null;  //語音偵測物件
export const voiceConfig = {
    id: 'mouth',
    voiceTutorialTopic: ["PA", "TA", "KA", "LA", "PA", "TA", "KA", "LA"], //教學模式題庫
    lockThreshold:4, //設定教學模式前面多少題要聽完語音才能動作
    MAX_HEALTH : 5,//預設石頭最大血量
    remainingHits : 1, //預設石頭當前血量
    stoneAnimState : "normal"// 記錄石頭動畫狀態 "normal", "hit", "explode"
};

// 語音辨識庫
const SYLLABLE_MAP = {
    "PA": ["pa", "趴", "怕", "啪", "叭", "吧", "巴", "把", "爸", "發", "爬", "帕", "哈", "八", "拔", "潘", "判", "旁", "胖", "派", "拍", "阿", "啊"],
    "TA": ["ta", "他", "她", "它", "踏", "塔", "大", "打", "答", "達", "太", "探", "塌", "沓", "特", "搭", "代"],
    "KA": ["ka", "卡", "喀", "咖", "咔", "嘎", "尬", "ga", "擦", "哈", "看", "ㄎ", "可", "克", "客", "渴", "考", "靠"],
    "LA": ["la", "拉", "啦", "喇", "辣", "拿", "哪", "納", "藍", "落", "來", "哩", "了", "老", "na", "那", "男"]
};

export async function initVoiceMode() {
    window.addEventListener('keydown', (event) => {
        switch(event.code) {
            case 'Space': 
            console.log(`🎯 命中目標音`);
            triggerStoneHit();
            try { recognition.stop(); } catch(e){}
            break; 
        }
    });
    // const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    // if (SpeechRecognition) {
    //     recognition = new SpeechRecognition();
    //     recognition.continuous = true; //設定為持續監聽模式
    //     recognition.interimResults = true;//API 在使用者「還沒講完一整句話」時，就先回傳暫時的辨識結果
    //     recognition.lang = 'zh-TW';
    //     recognition.onresult = (event) => { //如果遊戲沒在進行、正在教學畫面、或處於冷卻時間（hitCooldown，避免一次發音觸發太多次打擊），就直接略過
    //         console.log(1)
    //         if (!isDetecting || !isGameRunning || isTutorialLocked || hitCooldown) return;
    //         for (let i = event.resultIndex; i < event.results.length; i++) {
    //             const transcript = event.results[i][0].transcript.toLowerCase(); //辨識出的音
    //             console.log(`[發聲辨識] 聽到: "${transcript}"`); 
                
    //             const validWords = SYLLABLE_MAP[currentTargetSyllable]; //currentTargetSyllable當下題目音
    //             if (validWords && validWords.some(word => transcript.includes(word))) {
    //                 console.log(`🎯 命中目標音: ${currentTargetSyllable}!`);
    //                 triggerStoneHit();
    //                 try { recognition.stop(); } catch(e){}
    //                 break; 
    //             }
    //         }
    //     };

    //     recognition.onend = () => { //確保遊戲持續時聲音偵測不會斷掉
    //         if (isDetecting && isGameRunning) {
    //             try { recognition.start(); } catch(e){}
    //         }
    //     };
    // }
}

export function startVoiceDetection() {
    // 如果辨識系統已經在運作中（isDetecting 為 true），就直接跳出。
    // 這避免了玩家多次點擊切換按鈕，導致同時產生多個語音辨識實體（Instance），這會造成嚴重的效能問題與判定混亂。
    if (isDetecting) return; 
    isDetecting = true;
    
    if (recognitionMouth) { //如果「嘴型模式」的辨識物件還開著，先強制關掉它。這確保了系統資源（麥克風）能完全保留給目前的「發聲模式」。
        try { recognitionMouth.stop(); } catch(e){}
    }

    if (recognition) { //剛呼叫 .stop() 就立刻呼叫 .start()有可能出錯這裡延遲一點時間在呼叫
        try { recognition.stop(); } catch(e){}
        setTimeout(() => { try { recognition.start(); } catch(e){} }, 100);
    }

    //如果遊戲開始在進行題目渲染
    if(isGameRunning){
        predictLoop(); //AI 模型判定主迴圈（例如臉部追蹤或是音量頻譜分析）呼叫它代表「判定引擎」正式開始運轉，每一幀都會去檢查玩家有沒有達成動作
    }
}

export function stopVoiceDetection() {
    isDetecting = false; 
    if (recognition) { try { recognition.stop(); } catch(e){} }
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
    if (hitCooldown) return; 
    hitCooldown = true;
    voiceConfig.remainingHits--; //將這顆石頭的剩餘需要打擊次數減 1。
    
    // if (voiceConfig.remainingHits > 0) {
    //     // 狀態 A：還沒碎，觸發受擊動畫
    //     stoneAnimState = "hit"; 
    //     renderBelt(); // 叫畫家畫出扣血跟震動
        
    //     setTimeout(() => { 
    //         stoneAnimState = "normal"; 
    //         renderBelt(); // 震動結束，恢復正常
    //         hitCooldown = false; 
    //     }, 400);
        
    // } else {
    //     // 狀態 B：碎了，準備過關！
    //     stoneAnimState = "explode";
    //     renderBelt(); // 叫畫家畫出爆炸
        
    //     // 給予1秒鐘的時間顯示爆炸動畫後，交給總結算中心
    //     setTimeout(() => {
    //         triggerResult(true); // 🌟 過關結算交給它！
    //         hitCooldown = false; 
    //     }, 1000); 
    // }
    const stone = document.getElementById("stone-container");
    const hp = document.getElementById("stone-hp");

    if (voiceConfig.remainingHits > 0) {//石頭扣寫
        stone.classList.add("stone-hit");
        setTimeout(() => { stone.classList.remove("stone-hit"); hitCooldown = false; }, 400);
        hp.innerText = `剩餘 ${voiceConfig.remainingHits} 次`;
    } else {
        stone.classList.add("stone-explode"); //石頭破碎動畫
        if (gameStats && gameStats[currentTargetSyllable]) gameStats[currentTargetSyllable].success++; //寫入統計數據成功與失敗次數
        setTimeout(() => {
            hitCooldown = false; //解開連擊鎖
            triggerResult(true); //紀錄過關
        }, 1000); // 給予1秒鐘的時間顯示爆炸動畫
    }
}