const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Groq = require('groq-sdk');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('client/build'));

// 支援的音訊格式
const supportedFormats = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4'];

// 確保 uploads 目錄存在
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads', { recursive: true });
}

const upload = multer({ 
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (supportedFormats.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('不支援的音訊格式。支援格式：' + supportedFormats.join(', ')));
        }
    }
});

// 增強音訊預處理 - 噪音抑制和清理
async function enhanceAudioForTranscription(inputPath, enhancementLevel = 'medium') {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath)) {
            reject(new Error(`輸入檔案不存在: ${inputPath}`));
            return;
        }

        const outputPath = inputPath + '_enhanced.wav';
        
        // 根據增強等級選擇不同的濾波器組合
        let audioFilters = [];
        
        switch (enhancementLevel) {
            case 'light':
                // 輕度增強：基本噪音抑制
                audioFilters = [
                    'highpass=f=200',  // 移除低頻噪音
                    'lowpass=f=3400',  // 移除高頻噪音
                    'volume=1.2'       // 輕微增強音量
                ];
                break;
                
            case 'medium':
                // 中度增強：適合一般噪音環境
                audioFilters = [
                    'highpass=f=300',      // 移除低頻噪音
                    'afftdn=nr=12:nf=-50', // FFT 噪音抑制
                    'lowpass=f=3000',      // 移除高頻噪音
                    'compand=attacks=0.3:decays=1:points=-70/-70|-60/-20|1/0', // 動態範圍壓縮
                    'volume=1.5'           // 增強音量
                ];
                break;
                
            case 'aggressive':
                // 強力增強：適合嘈雜環境
                audioFilters = [
                    'highpass=f=400',           // 強力低頻濾波
                    'afftdn=nr=20:nf=-40',      // 強力 FFT 噪音抑制
                    'anlmdn=s=0.00001:p=0.004:r=0.004:m=15', // 非局部均值去噪
                    'lowpass=f=2800',           // 強力高頻濾波
                    'compand=attacks=0.1:decays=1:points=-80/-80|-70/-30|1/0', // 強力動態範圍壓縮
                    'volume=2.0'                // 大幅增強音量
                ];
                break;
                
            default:
                audioFilters = ['highpass=f=200', 'lowpass=f=3400'];
        }

        console.log(`開始音訊增強處理 (${enhancementLevel} 模式)...`);
        
        ffmpeg(inputPath)
            .audioCodec('pcm_s16le')
            .audioFrequency(16000)     // 降採樣到 16kHz，適合語音識別
            .audioChannels(1)          // 轉換為單聲道
            .audioFilters(audioFilters)
            .format('wav')
            .output(outputPath)
            .on('end', () => {
                console.log('音訊增強完成');
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('音訊增強失敗:', err);
                reject(err);
            })
            .run();
    });
}

// 轉換音訊格式為 mp3（如果需要）
async function convertToMp3(inputPath) {
    return new Promise((resolve, reject) => {
        // 檢查輸入檔案是否存在
        if (!fs.existsSync(inputPath)) {
            reject(new Error(`輸入檔案不存在: ${inputPath}`));
            return;
        }

        const ext = path.extname(inputPath).toLowerCase();
        
        // 如果已經是 mp3，直接返回
        if (ext === '.mp3') {
            resolve(inputPath);
            return;
        }
        
        const outputPath = inputPath + '.mp3';
        
        ffmpeg(inputPath)
            .audioCodec('libmp3lame')
            .audioBitrate(128)
            .format('mp3')
            .output(outputPath)
            .on('end', () => {
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('FFmpeg 錯誤:', err);
                reject(err);
            })
            .run();
    });
}

// 切割音訊檔案
async function splitAudioFile(inputPath, chunkDuration = 300) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const outputDir = path.dirname(inputPath);
        const baseName = path.basename(inputPath, path.extname(inputPath));

        ffmpeg(inputPath)
            .audioCodec('libmp3lame')
            .format('mp3')
            .addOptions([
                '-f', 'segment',
                '-segment_time', chunkDuration.toString(),
                '-reset_timestamps', '1'
            ])
            .output(path.join(outputDir, `${baseName}_chunk_%03d.mp3`))
            .on('end', () => {
                // 找到所有生成的切片
                const files = fs.readdirSync(outputDir);
                const chunkFiles = files.filter(file => 
                    file.startsWith(`${baseName}_chunk_`) && file.endsWith('.mp3')
                ).sort();
                
                const chunkPaths = chunkFiles.map(file => path.join(outputDir, file));
                resolve(chunkPaths);
            })
            .on('error', reject)
            .run();
    });
}

// 合併轉錄結果
function mergeTranscriptionResults(results) {
    let mergedText = '';
    let mergedSegments = [];
    let timeOffset = 0;

    results.forEach((result, index) => {
        if (result.text) {
            mergedText += (index > 0 ? ' ' : '') + result.text;
        }
        
        if (result.segments) {
            const adjustedSegments = result.segments.map(segment => ({
                ...segment,
                start: segment.start + timeOffset,
                end: segment.end + timeOffset
            }));
            mergedSegments.push(...adjustedSegments);
        }
        
        timeOffset += 300; // 假設每個切片是5分鐘
    });

    return {
        text: mergedText,
        segments: mergedSegments
    };
}

// 語音轉文字 API
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        const { apiKey, enableSpeakerIdentification, enhancementLevel = 'medium' } = req.body;
        
        if (!apiKey) {
            return res.status(400).json({ error: '請提供 Groq API 金鑰' });
        }

        const groq = new Groq({ apiKey });
        const audioFile = req.file;
        
        if (!audioFile) {
            return res.status(400).json({ error: '請上傳音訊檔案' });
        }

        console.log('收到檔案:', {
            originalname: audioFile.originalname,
            mimetype: audioFile.mimetype,
            size: audioFile.size,
            path: audioFile.path,
            enhancementLevel: enhancementLevel
        });

        // 音訊增強預處理
        const enhancedPath = await enhanceAudioForTranscription(audioFile.path, enhancementLevel);
        
        // 轉換為 mp3 格式（如果需要）
        const mp3Path = await convertToMp3(enhancedPath);

        // 檢查檔案大小，如果超過 25MB 則切割
        const stats = fs.statSync(mp3Path);
        const fileSizeInMB = stats.size / (1024 * 1024);
        
        let transcriptionResults = [];
        
        if (fileSizeInMB > 25) {
            // 切割大檔案
            const chunkPaths = await splitAudioFile(mp3Path);
            
            console.log(`檔案已切割為 ${chunkPaths.length} 個片段，開始並行處理...`);
            
            // 並行處理所有切片以提高速度
            const transcriptionPromises = chunkPaths.map(async (chunkPath, index) => {
                console.log(`開始處理片段 ${index + 1}/${chunkPaths.length}`);
                try {
                    // 首先做一次轉錄以檢測語言
                    const initialTranscription = await groq.audio.transcriptions.create({
                        file: fs.createReadStream(chunkPath),
                        model: 'whisper-large-v3',
                        response_format: 'verbose_json',
                        timestamp_granularities: ['segment']
                    });
                    
                    let transcription = initialTranscription;
                    
                    // 如果檢測到中文，重新轉錄以確保繁體中文輸出
                    if (initialTranscription.language === 'zh' || /[\u4e00-\u9fff]/.test(initialTranscription.text)) {
                        transcription = await groq.audio.transcriptions.create({
                            file: fs.createReadStream(chunkPath),
                            model: 'whisper-large-v3',
                            response_format: 'verbose_json',
                            timestamp_granularities: ['segment'],
                            language: 'zh',
                            prompt: '請使用繁體中文進行轉錄。這是一段中文語音。'
                        });
                    }
                    
                    console.log(`片段 ${index + 1} 處理完成`);
                    
                    // 清理切片檔案
                    if (fs.existsSync(chunkPath)) {
                        fs.unlinkSync(chunkPath);
                    }
                    
                    return transcription;
                } catch (error) {
                    console.error(`片段 ${index + 1} 處理失敗:`, error);
                    // 清理失敗的切片檔案
                    if (fs.existsSync(chunkPath)) {
                        fs.unlinkSync(chunkPath);
                    }
                    throw error;
                }
            });
            
            transcriptionResults = await Promise.all(transcriptionPromises);
        } else {
            // 直接處理小檔案
            // 首先做一次轉錄以檢測語言
            const initialTranscription = await groq.audio.transcriptions.create({
                file: fs.createReadStream(mp3Path),
                model: 'whisper-large-v3',
                response_format: 'verbose_json',
                timestamp_granularities: ['segment']
            });
            
            let transcription = initialTranscription;
            
            // 如果檢測到中文，重新轉錄以確保繁體中文輸出
            if (initialTranscription.language === 'zh' || /[\u4e00-\u9fff]/.test(initialTranscription.text)) {
                transcription = await groq.audio.transcriptions.create({
                    file: fs.createReadStream(mp3Path),
                    model: 'whisper-large-v3',
                    response_format: 'verbose_json',
                    timestamp_granularities: ['segment'],
                    language: 'zh',
                    prompt: '請使用繁體中文進行轉錄。這是一段中文語音。'
                });
            }
            
            transcriptionResults.push(transcription);
        }

        // 合併結果
        const finalResult = transcriptionResults.length > 1 
            ? mergeTranscriptionResults(transcriptionResults)
            : transcriptionResults[0];

        let response = {
            text: finalResult.text,
            segments: finalResult.segments
        };

        // 說話者識別（簡化版本）
        if (enableSpeakerIdentification === 'true') {
            response.speakerSegments = await identifySpeakers(finalResult.segments);
        }


        // 清理上傳的檔案
        try {
            if (fs.existsSync(audioFile.path)) {
                fs.unlinkSync(audioFile.path);
            }
            if (enhancedPath !== audioFile.path && fs.existsSync(enhancedPath)) {
                fs.unlinkSync(enhancedPath);
            }
            if (mp3Path !== audioFile.path && mp3Path !== enhancedPath && fs.existsSync(mp3Path)) {
                fs.unlinkSync(mp3Path);
            }
        } catch (cleanupError) {
            console.error('清理檔案時發生錯誤:', cleanupError);
        }

        res.json(response);
    } catch (error) {
        console.error('轉錄錯誤:', error);
        res.status(500).json({ error: '轉錄過程中發生錯誤: ' + error.message });
    }
});

// 簡化的說話者識別（基於音訊特徵）
async function identifySpeakers(segments) {
    const speakerSegments = [];
    let currentSpeaker = 'Speaker 1';
    let speakerCount = 1;

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        
        // 簡單的說話者切換邏輯（基於停頓時間）
        if (i > 0) {
            const prevSegment = segments[i - 1];
            const pauseDuration = segment.start - prevSegment.end;
            
            if (pauseDuration > 2.0) { // 停頓超過2秒切換說話者
                speakerCount++;
                currentSpeaker = `Speaker ${Math.min(speakerCount, 5)}`; // 最多5個說話者
            }
        }
        
        speakerSegments.push({
            ...segment,
            speaker: currentSpeaker
        });
    }

    return speakerSegments;
}

// 處理前端路由
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API 路由不存在' });
    } else {
        res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
    }
});

app.listen(PORT, () => {
    console.log(`伺服器運行在 http://localhost:${PORT}`);
});