const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('client/build'));

// 支援的音訊格式
const supportedFormats = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4'];

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

// 轉換音訊格式為 mp3（如果需要）
async function convertToMp3(inputPath) {
    return new Promise((resolve, reject) => {
        const ext = path.extname(inputPath).toLowerCase();
        
        // 如果已經是 mp3，直接返回
        if (ext === '.mp3') {
            resolve(inputPath);
            return;
        }
        
        const outputPath = inputPath.replace(ext, '.mp3');
        
        ffmpeg(inputPath)
            .audioCodec('libmp3lame')
            .audioBitrate(128)
            .format('mp3')
            .output(outputPath)
            .on('end', () => {
                resolve(outputPath);
            })
            .on('error', reject)
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
        const { apiKey, enableSpeakerIdentification, enableSummarization } = req.body;
        
        if (!apiKey) {
            return res.status(400).json({ error: '請提供 OpenAI API 金鑰' });
        }

        const openai = new OpenAI({ apiKey });
        const audioFile = req.file;
        
        if (!audioFile) {
            return res.status(400).json({ error: '請上傳音訊檔案' });
        }

        // 轉換為 mp3 格式（如果需要）
        const mp3Path = await convertToMp3(audioFile.path);

        // 檢查檔案大小，如果超過 25MB 則切割
        const stats = fs.statSync(mp3Path);
        const fileSizeInMB = stats.size / (1024 * 1024);
        
        let transcriptionResults = [];
        
        if (fileSizeInMB > 25) {
            // 切割大檔案
            const chunkPaths = await splitAudioFile(mp3Path);
            
            // 處理每個切片
            for (const chunkPath of chunkPaths) {
                const transcription = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(chunkPath),
                    model: 'whisper-1',
                    response_format: 'verbose_json',
                    timestamp_granularities: ['segment']
                });
                
                transcriptionResults.push(transcription);
                
                // 清理切片檔案
                fs.unlinkSync(chunkPath);
            }
        } else {
            // 直接處理小檔案
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(mp3Path),
                model: 'whisper-1',
                response_format: 'verbose_json',
                timestamp_granularities: ['segment']
            });
            
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

        // 重點整理
        if (enableSummarization === 'true') {
            const summary = await openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: '請為以下文字內容製作重點整理，用繁體中文回答。'
                    },
                    {
                        role: 'user',
                        content: finalResult.text
                    }
                ],
                max_tokens: 500
            });
            
            response.summary = summary.choices[0].message.content;
        }

        // 清理上傳的檔案
        fs.unlinkSync(audioFile.path);
        if (mp3Path !== audioFile.path) {
            fs.unlinkSync(mp3Path);
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