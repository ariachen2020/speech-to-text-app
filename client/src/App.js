import React, { useState, useRef } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [transcription, setTranscription] = useState('');
  const [segments, setSegments] = useState([]);
  const [speakerSegments, setSpeakerSegments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [enableSpeakerIdentification, setEnableSpeakerIdentification] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [error, setError] = useState('');
  


  // 處理檔案上傳
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setAudioFile(file);
    }
  };

  // 轉錄音訊
  const transcribeAudio = async () => {
    if (!audioFile) {
      setError('請先錄音或上傳音訊檔案');
      return;
    }

    if (!apiKey) {
      setError('請輸入 Groq API 金鑰');
      return;
    }

    setLoading(true);
    setError('');
    setTranscription('');
    setSegments([]);
    setSpeakerSegments([]);
    setProgress('準備上傳檔案...');

    try {
      const formData = new FormData();
      formData.append('audio', audioFile);
      formData.append('apiKey', apiKey);
      formData.append('enableSpeakerIdentification', enableSpeakerIdentification.toString());

      // 根據檔案大小估算處理時間
      const fileSizeInMB = audioFile.size / (1024 * 1024);
      if (fileSizeInMB > 25) {
        setProgress(`大檔案處理中 (${fileSizeInMB.toFixed(1)}MB)，預計需要 ${Math.ceil(fileSizeInMB / 5)} 分鐘...`);
      } else {
        setProgress(`處理中 (${fileSizeInMB.toFixed(1)}MB)，請稍候...`);
      }

      const response = await axios.post('/api/transcribe', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 600000, // 10分鐘超時
      });

      setTranscription(response.data.text);
      
      if (response.data.segments) {
        setSegments(response.data.segments);
      }
      
      if (response.data.speakerSegments) {
        setSpeakerSegments(response.data.speakerSegments);
      }
      
    } catch (err) {
      setError('轉錄失敗: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  // 格式化時間
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>語音轉文字應用程式 (Groq)</h1>
        <p>支援 iPhone 語音備忘錄 (.m4a)、MP3、WAV 等格式</p>
      </header>

      <main className="App-main">
        {/* API 金鑰設定 */}
        <div className="api-key-section">
          <h2>API 設定</h2>
          <input
            type="password"
            placeholder="輸入 Groq API 金鑰"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="api-key-input"
          />
          <small>您的 Groq API 金鑰不會被儲存，僅用於本次轉錄</small>
        </div>


        {/* 檔案上傳區域 */}
        <div className="upload-section">
          <h2>上傳音訊檔案</h2>
          <input
            type="file"
            accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4"
            onChange={handleFileUpload}
            className="file-input"
          />
          <small>支援格式：MP3, WAV, M4A, AAC, OGG, FLAC, MP4</small>
          {audioFile && (
            <div className="file-info">
              <p>已選擇檔案: {audioFile.name}</p>
              <p>檔案大小: {(audioFile.size / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
          )}
        </div>

        {/* 功能選項 */}
        <div className="options-section">
          <h2>功能選項</h2>
          <div className="option">
            <label>
              <input
                type="checkbox"
                checked={enableSpeakerIdentification}
                onChange={(e) => setEnableSpeakerIdentification(e.target.checked)}
              />
              啟用說話者識別
            </label>
          </div>
          <div className="option">
            <label>
              <input
                type="checkbox"
                checked={showTimestamps}
                onChange={(e) => setShowTimestamps(e.target.checked)}
              />
              顯示時間標記
            </label>
          </div>
        </div>

        {/* 轉錄按鈕 */}
        <div className="transcribe-section">
          <button 
            onClick={transcribeAudio} 
            disabled={loading || !audioFile || !apiKey}
            className="transcribe-button"
          >
            {loading ? '轉錄中...' : '開始轉錄'}
          </button>
          {progress && (
            <div className="progress-section">
              <p className="progress-text">{progress}</p>
            </div>
          )}
        </div>

        {/* 錯誤訊息 */}
        {error && (
          <div className="error-section">
            <p className="error-message">{error}</p>
          </div>
        )}

        {/* 轉錄結果 */}
        {transcription && (
          <div className="results-section">
            <h2>轉錄結果</h2>
            {showTimestamps && segments.length > 0 ? (
              <div className="transcription-segments">
                {segments.map((segment, index) => (
                  <div key={index} className="transcription-segment">
                    <div className="segment-time">
                      {formatTime(segment.start)} - {formatTime(segment.end)}
                    </div>
                    <div className="segment-text">{segment.text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="transcription-text">
                <p>{transcription}</p>
              </div>
            )}
          </div>
        )}

        {/* 說話者識別結果 */}
        {speakerSegments.length > 0 && (
          <div className="speakers-section">
            <h2>說話者識別</h2>
            <div className="speaker-segments">
              {speakerSegments.map((segment, index) => (
                <div key={index} className="speaker-segment">
                  <div className="speaker-info">
                    <span className="speaker-name">{segment.speaker}</span>
                    <span className="time-range">
                      {formatTime(segment.start)} - {formatTime(segment.end)}
                    </span>
                  </div>
                  <div className="speaker-text">{segment.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;