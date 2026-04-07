// ==========================================
// 核心模組載入 (總指揮官)
// ==========================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

import { initMouthMode, startMouthDetection, stopMouthDetection, resumeAudio, setMicStatus } from './mode_mouth.js'; // 👈 確保有 setMicStatus
import { initTongueMode, startTongueDetection, stopTongueDetection } from './mode_tongue.js';
import { initVoiceMode, startVoiceDetection, stopVoiceDetection } from './mode_voice.js';

// ==========================================
// 全域變數匯出 (讓其他模組可以使用)
// ==========================================
export let currentVrm = null;
export let isGameRunning = false;
export let currentDifficulty = "hard";
export let currentTrainingMode = "mouth";
export let poseQueue = [];
export let isTutorialLocked = false;
export let accumulatedHoldTime = 0;

export const DIFFICULTY_CONFIG = {
    tutorial: { requireAudio: true, volThreshold: 15, holdDuration: 1500, accumulateProgress: true, isTutorial: true, jaw_A: 0.25, pucker_U: 0.4, funnel_O: 0.25, stretch_I: 0.3, stretch_E: 0.15 },
    easy: { requireAudio: false, volThreshold: 0, holdDuration: 2000, accumulateProgress: true, isTutorial: false, jaw_A: 0.25, pucker_U: 0.4, funnel_O: 0.25, stretch_I: 0.3, stretch_E: 0.15 },
    medium: { requireAudio: true, volThreshold: 15, holdDuration: 2000, accumulateProgress: false, isTutorial: false, jaw_A: 0.35, pucker_U: 0.55, funnel_O: 0.35, stretch_I: 0.4, stretch_E: 0.25 },
    hard: { requireAudio: true, volThreshold: 25, holdDuration: 2000, accumulateProgress: false, isTutorial: false, jaw_A: 0.45, pucker_U: 0.7, funnel_O: 0.4, stretch_I: 0.5, stretch_E: 0.35 }
};

// --- 私有 UI 與遊戲變數 ---
let scene, camera, renderer, clock;
let turnTimeLeft = 5000;
let blinkTimer = 0;
let nextBlinkInterval = 3;
const poses = ["ㄚ", "ㄧ", "ㄨ", "ㄟ", "ㄛ"]; 

export let gameStats = {};

// 音效設定
const bgm = new Audio('./bgm.mp3');
bgm.loop = true;
bgm.volume = 0.25; 

// ==========================================
// 1. 初始化系統與 3D 渲染
// ==========================================
async function startSystem() {
    initThreeJS(); 
    await initMouthMode();
    await initTongueMode();
    await initVoiceMode();
    
    // 系統載入完成後，立刻啟動背景頭部/嘴部追蹤，永遠不關閉 
    startMouthDetection(); 
    startTongueDetection();

    document.getElementById("loading-overlay").style.display = "none";
    
    const btns = ["btn-tutorial", "btn-easy", "btn-medium", "btn-hard"];
    btns.forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.disabled = false;
    });
}

function initThreeJS() {
    const container = document.getElementById("canvas-container");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb1e1ff); 

    camera = new THREE.PerspectiveCamera(30, container.clientWidth / container.clientHeight, 0.1, 20);
    camera.position.set(0, 1.52, 0.8); 
    camera.lookAt(0, 1.52, 0); 

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace; 
    container.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 0.4); 
    light.position.set(1, 1, 1).normalize();
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3)); 

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('./bg_grassland.jpg', texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.background = texture;
    });
    
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load("./vrm/VRMWithTongue.vrm", (gltf) => {
        const vrm = gltf.userData.vrm;
        scene.add(vrm.scene);
        currentVrm = vrm;
        vrm.scene.rotation.y = 0; 
        
        const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        if (leftUpperArm) leftUpperArm.rotation.z = -1.1; 
        if (rightUpperArm) rightUpperArm.rotation.z = 1.1;
    });

    clock = new THREE.Clock();
    animate3D();
}
// 🌟 視窗大小監聽：當螢幕翻轉或改變尺寸時，重新計算 3D 畫面比例
window.addEventListener('resize', () => {
    const container = document.querySelector('.left-panel');
    // 確保 renderer 和 camera 有被正確宣告且可以使用
    if (container && typeof renderer !== 'undefined' && typeof camera !== 'undefined') {
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        // 更新畫布大小
        renderer.setSize(width, height);
        // 更新攝影機比例
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
});
function animate3D() {
    requestAnimationFrame(animate3D);
    const deltaTime = clock.getDelta();
    
    if (currentVrm) {
        blinkTimer += deltaTime;
        let blinkValue = 0;
        if (blinkTimer >= nextBlinkInterval) {
            let blinkPhase = blinkTimer - nextBlinkInterval; 
            if (blinkPhase < 0.1) blinkValue = blinkPhase / 0.1;
            else if (blinkPhase < 0.2) blinkValue = 1 - ((blinkPhase - 0.1) / 0.1);
            else {
                blinkTimer = 0;
                nextBlinkInterval = 2 + Math.random() * 3;
                blinkValue = 0;
            }
        }
        currentVrm.expressionManager.setValue('blinkLeft', blinkValue);
        currentVrm.expressionManager.setValue('blinkRight', blinkValue);
        currentVrm.expressionManager.setValue('blink', blinkValue); 
        currentVrm.update(deltaTime);
    }
    renderer.render(scene, camera);
}

// ==========================================
// 2. 模式切換邏輯
// ==========================================
document.getElementById("mode-mouth")?.addEventListener('click', () => switchTrainingMode('mouth'));
document.getElementById("mode-voice")?.addEventListener('click', () => switchTrainingMode('voice'));
document.getElementById("mode-tongue")?.addEventListener('click', () => switchTrainingMode('tongue'));

function switchTrainingMode(mode) {
    if (isGameRunning) return; 
    currentTrainingMode = mode;
    console.log(`切換至訓練模式：${mode}`);
    //清空泡泡重新塞進題目
    poseQueue = [];
    let targetList = getSequence();
    poseQueue.push(targetList[Math.floor(Math.random() * targetList.length)]);
    // UI 按鈕切換
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`mode-${mode}`)?.classList.add('active');

    if (mode === 'voice') {
        startVoiceDetection(); // 啟動發聲模式專屬邏輯
    } else {
        stopVoiceDetection();  // 切到其他模式時關閉
    }
}

// ==========================================
// 3. 遊戲流程控制 (開始、結束、過關判定)
// ==========================================

// 安全綁定點擊事件
document.getElementById("btn-tutorial")?.addEventListener('click', () => startGame("tutorial"));
document.getElementById("btn-easy")?.addEventListener('click', () => startGame("easy"));
document.getElementById("btn-medium")?.addEventListener('click', () => startGame("medium"));
document.getElementById("btn-hard")?.addEventListener('click', () => startGame("hard"));
document.getElementById("endBtn")?.addEventListener('click', endGame);

// 🎙️ 修復：語音判定開關按鈕 (點擊時同步隱藏/顯示音量條)
document.getElementById("toggleMicBtn")?.addEventListener('click', (e) => {
    const btn = e.target;
    const isOn = btn.innerText.includes('開啟');
    const meterContainer = document.getElementById("audio-meter-container");

    if (isOn) {
        btn.innerText = '🎙️ 語音判定：關閉';
        btn.classList.add('off');
        setMicStatus(false);
        // 👇 改用 visibility 隱藏，保留空間
        if (meterContainer) meterContainer.style.visibility = "hidden"; 
    } else {
        btn.innerText = '🎙️ 語音判定：開啟';
        btn.classList.remove('off');
        setMicStatus(true);
        // 👇 改用 visibility 顯示
        if (meterContainer && isGameRunning) meterContainer.style.visibility = "visible"; 
    }
});

// 強制暴露給全域
window.startGame = startGame;
window.endGame = endGame;

// 📖 修復：定義新手教學的專屬順序 (ㄚ、ㄧ、ㄨ 循環 3 次，共 9 題)
let tutorialIndex = 0;
const TUTORIAL_SEQUENCE = ["ㄚ", "ㄧ", "ㄨ", "ㄚ", "ㄧ", "ㄨ", "ㄚ", "ㄧ", "ㄨ"];

function startGame(mode) {
    // 確保音訊環境啟動
    import('./mode_mouth.js').then(module => {
        if(module.resumeAudio) module.resumeAudio(); 
    });

    currentDifficulty = mode; 
    isGameRunning = true;
    isTutorialLocked = (mode === "tutorial"); 
    tutorialIndex = 0; 
    
    bgm.play().catch(e => {});

    const micBtn = document.getElementById("toggleMicBtn");
    const isMicOff = micBtn && micBtn.classList.contains('off');
    const isEasyMode = (mode === "easy");
    const isTongueMode = (currentTrainingMode === 'tongue'); 
    const isVoiceMode = (currentTrainingMode === 'voice'); // 判斷發聲模式

    // 🌟 修復 1：動態重置統計資料 (根據不同模式準備不同的計分板)
    gameStats = {};
    let statKeys = [];
    if (currentTrainingMode === 'mouth') statKeys = ["ㄚ", "ㄧ", "ㄨ", "ㄟ", "ㄛ"];
    else if (currentTrainingMode === 'tongue') statKeys = ['⬆️', '⬇️', '⬅️', '➡️'];
    else if (currentTrainingMode === 'voice') statKeys = ["PA", "TA", "KA", "LA"];
    
    statKeys.forEach(k => { gameStats[k] = { success: 0, fail: 0 }; });

    // 切換 UI 顯示狀態
    const els = {
        "tutorial-controls": "none",
        "start-controls": "none",
        "game-controls": "flex",
        "game-ui": isVoiceMode ? "none" : "flex",
        "voice-game-ui": isVoiceMode ? "flex" : "none", 
        "stats-panel": "none",
        "audio-meter-container": "flex" 
    };
    for (let id in els) {
        let el = document.getElementById(id);
        if (el) el.style.display = els[id];
    }

    const meterContainer = document.getElementById("audio-meter-container");

    // 🌟 UI 與麥克風強制連動邏輯
    import('./mode_mouth.js').then(module => {
        if (isVoiceMode) {
            // 🗣️ 發聲模式：隱藏按鈕，顯示音量條，並【強制開啟麥克風】
            if (micBtn) { micBtn.style.display = "none"; }
            if (meterContainer) { 
                meterContainer.style.display = "flex"; 
                meterContainer.style.visibility = "visible"; 
            }
            if (module.setMicStatus) module.setMicStatus(true); 
        } 
        else if (isTongueMode) {
            // 👅 舌頭模式：不需要聲音，全部隱藏
            if (micBtn) { micBtn.style.display = "none"; }
            if (meterContainer) { meterContainer.style.display = "none"; }
        } 
        else {
            // 👄 嘴型模式：依據難度顯示
            if (micBtn) {
                micBtn.style.display = "block";
                micBtn.style.display = isEasyMode ? "none" : "block";
            }
            if (meterContainer) {
                meterContainer.style.display = "flex";
                meterContainer.style.visibility = (isEasyMode || isMicOff) ? "hidden" : "visible";
            }
            if (module.setMicStatus) module.setMicStatus(!isMicOff);
        }
    });

    if (isVoiceMode) {
        initQueue(); 
        import('./mode_voice.js').then(module => { module.startVoiceDetection(); });
    }
    startTurnTimer();
}

function endGame() {
    isGameRunning = false;
    isTutorialLocked = false; 
    bgm.pause();
    window.speechSynthesis.cancel(); 
    
    // 隱藏舌頭的冰淇淋
    const ic = document.getElementById("ice-cream-target");
    if (ic) ic.style.display = "none";

    // 🌟 修復 3：遊戲結束時強制隱藏巨石介面
    const voiceUI = document.getElementById("voice-game-ui");
    if (voiceUI) voiceUI.style.display = "none";

    // 恢復 UI 顯示狀態
    const els = {
        "tutorial-controls": "flex",
        "start-controls": "flex",
        "game-controls": "none",
        "game-ui": "none",
        "audio-meter-container": "none" 
    };
    for (let id in els) {
        let el = document.getElementById(id);
        if (el) el.style.display = els[id];
    }
    
    // 🌟 修復 4：動態生成符合當前模式的結算報表
    const statusDisplay = document.getElementById("status-message");
    if (statusDisplay) {
        if (currentDifficulty !== "tutorial") { 
            statusDisplay.innerText = "挑戰結束！查看結算：";
            const statsPanel = document.getElementById("stats-panel");
            if (statsPanel) {
                statsPanel.style.display = "block";
                let html = '<h3 style="color: #333; text-align: center;">📊 動作達成率統計</h3><ul style="color: #333; font-size: 18px; padding-left: 20px;">';
                
                for (let key in gameStats) {
                    if (currentTrainingMode === 'voice') {
                        // 發聲模式專屬文字
                        html += `<li style="margin-bottom: 10px;"><strong>${key}</strong>: 成功擊碎 ${gameStats[key].success} 顆巨石</li>`;
                    } else {
                        // 嘴型與舌頭模式的文字
                        let total = gameStats[key].success + gameStats[key].fail;
                        let rate = total > 0 ? Math.round((gameStats[key].success / total) * 100) : 0;
                        html += `<li style="margin-bottom: 10px;"><strong>${key}</strong>: 成功 ${gameStats[key].success} 次 / 失敗 ${gameStats[key].fail} 次 (達成率: ${rate}%)</li>`;
                    }
                }
                html += '</ul>';
                statsPanel.innerHTML = html;
            }
        } else {
            statusDisplay.innerText = "已離開教學模式，請選擇難度開始挑戰！";
        }
    }
}

// ==========================================
// 4. 遊戲軌道與進度相關輔助函數
// ==========================================

// 📖 動態取得教學順序 (根據當前模式切換)
function getTutorialSequence() {
    if (currentTrainingMode === 'tongue') {
        return ["⬆️", "⬇️", "⬅️", "➡️", "⬆️", "⬇️", "⬅️", "➡️", "⬆️"];
    }
    if (currentTrainingMode === 'voice') {
        return ["PA", "TA", "KA", "LA", "PA", "TA", "KA", "LA"];
    }
    return ["ㄚ", "ㄧ", "ㄨ", "ㄚ", "ㄧ", "ㄨ", "ㄚ", "ㄧ", "ㄨ"];
}

function getSequence() {
    if (currentTrainingMode === 'tongue') {
        return ["⬆️", "⬇️", "⬅️", "➡️"];
    }
    if (currentTrainingMode === 'voice') {
        return ["PA", "TA", "KA", "LA"];
    }
    return ["ㄚ", "ㄧ", "ㄨ"];
}

// 📖 產生陣列的邏輯
function initQueue() {
    poseQueue = [];
    if (currentDifficulty === "tutorial") {
        // 新手教學題目
        const seq = getTutorialSequence();
        for (let i = 0; i < 6; i++) poseQueue.push(seq[i]);
    } else {
        // 🔴 初中高級題目
        let targetList = getSequence();
        for (let i = 0; i < 6; i++) poseQueue.push(targetList[Math.floor(Math.random() * targetList.length)]);
    }
    renderBelt();
}

function renderBelt() {
    const conveyorBelt = document.getElementById("conveyor-belt");
    if(!conveyorBelt) return;
    conveyorBelt.innerHTML = "";
    conveyorBelt.style.transition = "none"; 
    conveyorBelt.style.transform = "translateX(0)";

    poseQueue.forEach((pose, index) => {
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        if (index === 0) bubble.classList.add("current");
        bubble.id = `bubble-${index}`;
        bubble.innerText = pose;
        conveyorBelt.appendChild(bubble);
    });
}

function startTurnTimer() {
    if (!isGameRunning) return;
    const targetPose = poseQueue[0];
    const statusDisplay = document.getElementById("status-message");
    if (statusDisplay) statusDisplay.innerText = `${targetPose} 維持！！！`;
    accumulatedHoldTime = 0; 

    // 👇 翻譯語音
    let spokenText = targetPose;
    if (targetPose === '⬆️') spokenText = '舌頭往上';
    else if (targetPose === '⬇️') spokenText = '舌頭往下';
    else if (targetPose === '⬅️') spokenText = '舌頭往左';
    else if (targetPose === '➡️') spokenText = '舌頭往右';

    // ==========================================
    // 🍦 冰淇淋召喚術：精準定位在 3D 模型框內
    // ==========================================
    let ic = document.getElementById('ice-cream-target');
    if (!ic) {
        ic = document.createElement('div');
        ic.id = 'ice-cream-target';
        ic.innerText = '🍦';
        
        // 👇 核心修改：尋找 3D 畫布，把冰淇淋塞進它的父元素裡面
        const canvas3D = document.querySelector('canvas');
        if (canvas3D && canvas3D.parentElement) {
            canvas3D.parentElement.style.position = 'relative'; // 確保父元素可以定位
            canvas3D.parentElement.appendChild(ic);
        } else {
            document.body.appendChild(ic); // 備用方案
        }
    }
    
    // 清除舊動畫與位置
    ic.className = ''; 
    
    if (currentTrainingMode === 'tongue') {
        ic.style.display = 'block';
        // 根據箭頭決定冰淇淋位置
        if (targetPose === '⬆️') ic.classList.add('ic-up');
        else if (targetPose === '⬇️') ic.classList.add('ic-down');
        else if (targetPose === '⬅️') ic.classList.add('ic-left');
        else if (targetPose === '➡️') ic.classList.add('ic-right');
    } else {
        ic.style.display = 'none'; // 如果不是舌頭模式就隱藏
    }
    // ==========================================

    const currentBubble = document.getElementById("bubble-0");
    
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(`請跟著喊：${spokenText}`);
    utterance.lang = "zh-TW";

    if (currentDifficulty === "tutorial") {
        isTutorialLocked = true; // 進入鎖定狀態 (第一循環)
        
        utterance.onend = () => {
            // 第二循環 (tutorialIndex >= 4) 時，可以設定不鎖定，或者直接由 user 指令決定
            // 根據你的需求：第一循環先講解 (Locked)，第二循環不限制
            if (tutorialIndex >= 4) {
                isTutorialLocked = false; 
            } else {
                isTutorialLocked = false; // 講解完畢，解鎖讓玩家發聲
            }
        };
    } else {
        isTutorialLocked = false; 
    }
    window.speechSynthesis.speak(utterance);
}

// 過關/失敗處理器
export function triggerResult(isSuccess) {
    const targetBubble = document.getElementById("bubble-0");
    const conveyorBelt = document.getElementById("conveyor-belt");
    const ic = document.getElementById("ice-cream-target"); 

    if (isSuccess) {
        gameStats[poseQueue[0]] && gameStats[poseQueue[0]].success++;
        if(targetBubble) targetBubble.classList.add("pop-animation"); 
        if (ic && currentTrainingMode === 'tongue') ic.classList.add('ic-pop'); 
    } else {
        gameStats[poseQueue[0]] && gameStats[poseQueue[0]].fail++;
        if(targetBubble) targetBubble.classList.add("fade-animation"); 
    }

    if (conveyorBelt) {
        conveyorBelt.style.transition = "transform 0.5s ease-in-out";
        conveyorBelt.style.transform = "translateX(-110px)"; 
    }

    setTimeout(() => {
        poseQueue.shift(); 
        
        // 👇 徹底分流：確保教學結束就是結束，一般模式就是無限隨機
        if (currentDifficulty === "tutorial") {
            tutorialIndex++;
            if (tutorialIndex >= 9) { 
                endGame();
                const statusDisplay = document.getElementById("status-message");
                if (statusDisplay) statusDisplay.innerText = "🎉 新手教學完成！請選擇難度開始挑戰！";
                return; 
            }
            const seq = getTutorialSequence();
            
            let nextItemIndex = tutorialIndex + 5;
            if (nextItemIndex < seq.length) { // 這裡建議用 seq.length 比較保險
                poseQueue.push(seq[nextItemIndex]);
            } else {
                poseQueue.push("⭐"); 
            }
        } else {
            // 一般難度的無限替補
            let targetList = getSequence();
            poseQueue.push(targetList[Math.floor(Math.random() * targetList.length)]);
        }

        renderBelt(); 
        startTurnTimer(); 
    }, 500); 
}

// 啟動系統
startSystem();