const { ActivityHandler, MessageFactory } = require('botbuilder');
const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');
const axios = require('axios');
const { OpenAIClient } = require('@azure/openai');
const { AzureKeyCredential } = require('@azure/core-auth');





require('dotenv').config();

// Azure Computer Vision APIの設定
const visionKey = process.env.VISION_KEY;
const visionEndpoint = process.env.VISION_ENDPOINT;
const computerVisionClient = new ComputerVisionClient(
    new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': visionKey } }), visionEndpoint
);

// Azure OpenAI APIの設定
const openAiEndpoint = process.env.EndPoint;
const openAiApiKey = process.env.ApiKey;
const deploymentName = 'gpt4';
// クライアントの作成
const openAiClient = new OpenAIClient(openAiEndpoint, new AzureKeyCredential(openAiApiKey));

class AOAIOCRBot extends ActivityHandler {
    constructor() {
        super();

        // ユーザーからメッセージが送信されたときの処理
        this.onMessage(async (context, next) => {
            console.log('メッセージを受信しました:', context.activity.text || '添付ファイルあり');
            
            if (context.activity.attachments && context.activity.attachments.length > 0) {
                // 画像が送信された場合
                const imageUrl = context.activity.attachments[0].contentUrl;
                console.log('画像URL:', imageUrl);

                // 添付ファイルのデータをバイナリで取得
                const imageBuffer = await this.downloadImageAsBuffer(imageUrl);

                if (imageBuffer) {
                    const ocrResult = await this.performOCR(imageBuffer);

                    if (ocrResult) {
                        // OCR結果をOpenAIで翻訳と要約
                        const translatedSummary = await this.getOpenAiTranslationAndSummary(ocrResult);

                        await context.sendActivity(MessageFactory.text(`OCR結果:\n${ocrResult}`));
                        await context.sendActivity(MessageFactory.text(`\n${translatedSummary}`));
                    } else {
                        await context.sendActivity(MessageFactory.text('画像からテキストを認識できませんでした。'));
                    }
                } else {
                    await context.sendActivity(MessageFactory.text('画像のダウンロードに失敗しました。'));
                }
            }

            // 次の処理へ
            await next();
        });

        // ユーザーがボットに追加されたときの処理
        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            const welcomeText = 'Hello and welcome!';
            for (let i = 0; i < membersAdded.length; i++) {
                if (membersAdded[i].id !== context.activity.recipient.id) {
                    await context.sendActivity(MessageFactory.text(welcomeText, welcomeText));
                }
            }

            // 次の処理へ
            await next();
        });
    }

    // 画像のバイナリデータを取得するメソッド
    async downloadImageAsBuffer(imageUrl) {
        try {
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer', // バイナリデータとして取得
            });
            return Buffer.from(response.data, 'binary');
        } catch (err) {
            console.error('画像のダウンロードエラー:', err);
            return null;
        }
    }

    // OCR処理のメソッド（バイナリデータを使う）
    async performOCR(imageBuffer) {
        try {
            console.log(`画像を処理中...`);

            // バイナリデータをAzure Computer Vision APIに送信
            const result = await computerVisionClient.readInStream(imageBuffer);
            const operation = result.operationLocation.split('/').pop();

            // OCRの結果が完了するまで待機
            let ocrResult;
            while (true) {
                ocrResult = await computerVisionClient.getReadResult(operation);
                if (ocrResult.status === 'succeeded') break;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 認識されたテキストを整形して返す
            const readResults = ocrResult.analyzeResult.readResults;
            let extractedText = '';
            for (const page of readResults) {
                for (const line of page.lines) {
                    extractedText += line.words.map(word => word.text).join(' ') + '\n';
                }
            }
            return extractedText.trim();
        } catch (err) {
            console.error('OCRエラー:', err);
            return null;
        }
    }

    // OpenAIを使ってOCR結果の翻訳と要約を取得するメソッド
    async getOpenAiTranslationAndSummary(ocrText) {
        const messages = [
            { role: "system", content: "あなたは翻訳と要約が得意なアシスタントです。" },
            { role: "user", content: `以下の文章を翻訳した文章、その内容を要約した文章をそれぞれ出力してください:\n\n${ocrText}` }
        ];

        let translationSummary = '';

        try {
            const events = openAiClient.listChatCompletions(deploymentName, messages, { maxTokens: 256 });

            for await (const event of events) {
                for (const choice of event.choices) {
                    const delta = choice.delta?.content;
                    if (delta !== undefined) {
                        translationSummary += delta;
                    }
                }
            }
        } catch (err) {
            console.error('OpenAI APIエラー:', err);
            return "翻訳または要約に失敗しました。";
        }

        return translationSummary;
    }
}

module.exports.AOAIOCRBot = AOAIOCRBot;
