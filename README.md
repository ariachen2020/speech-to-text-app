# 語音轉文字應用程式

一個支援語音轉文字、說話者識別和重點整理的 Web 應用程式。

## 功能特色

- 🎤 **即時錄音**：支援瀏覽器內錄音
- 📁 **檔案上傳**：支援多種音訊格式（MP3, WAV, M4A, AAC, OGG, FLAC, MP4）
- 🔄 **大檔案處理**：自動切割超過 25MB 的檔案
- 👥 **說話者識別**：自動識別不同說話者
- 📝 **重點整理**：AI 生成內容摘要
- 🔐 **API 金鑰管理**：在頁面上輸入 OpenAI API 金鑰
- 🌐 **支援 iPhone 語音備忘錄**：完美支援 .m4a 格式

## 技術架構

- **前端**：React.js
- **後端**：Node.js + Express
- **語音轉文字**：OpenAI Whisper API
- **重點整理**：OpenAI GPT API
- **音訊處理**：FFmpeg
- **部署**：Zeabur

## 本地開發

1. 克隆專案：
\`\`\`bash
git clone <repository-url>
cd speech-to-text-app
\`\`\`

2. 安裝後端依賴：
\`\`\`bash
npm install
\`\`\`

3. 安裝前端依賴：
\`\`\`bash
cd client
npm install
cd ..
\`\`\`

4. 啟動開發伺服器：
\`\`\`bash
npm run dev
\`\`\`

5. 在瀏覽器中開啟 http://localhost:3000

## 部署到 Zeabur

1. 連接您的 GitHub 儲存庫到 Zeabur
2. 選擇此專案
3. Zeabur 會自動使用 \`zeabur.yaml\` 配置進行部署

## 使用方法

1. 在頁面上輸入您的 OpenAI API 金鑰
2. 選擇錄音或上傳音訊檔案
3. 選擇需要的功能（說話者識別、重點整理）
4. 點擊「開始轉錄」
5. 等待處理完成，查看結果

## 支援的檔案格式

- MP3
- WAV
- M4A（iPhone 語音備忘錄）
- AAC
- OGG
- FLAC
- MP4

## 注意事項

- 需要 OpenAI API 金鑰才能使用
- 大檔案會自動切割處理，可能需要較長時間
- 建議檔案大小不超過 100MB
- 說話者識別功能為簡化版本，準確度可能有限

## 隱私保護

- API 金鑰不會被儲存在伺服器上
- 上傳的音訊檔案處理完成後會自動刪除
- 轉錄結果僅在當前會話中保留