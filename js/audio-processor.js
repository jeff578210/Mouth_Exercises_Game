// audio-processor.js //在背景不斷把麥克風的聲音打包，然後丟回給主程式
class AudioProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const channelData = input[0]; // 取得單聲道的 Float32Array 聲波資料
            // 將聲波資料傳回主執行緒
            this.port.postMessage(channelData); 
        }
        return true; // 保持這個處理器活著
    }
}

// 註冊這個處理器
registerProcessor('audio-processor', AudioProcessor);