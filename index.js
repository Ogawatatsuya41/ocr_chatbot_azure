const path = require('path');
const dotenv = require('dotenv');
const restify = require('restify');

// 環境変数のロード
const ENV_FILE = path.join(__dirname, '.env');
dotenv.config({ path: ENV_FILE });

// Bot Framework SDK関連のインポート
const {
    CloudAdapter,
    ConfigurationServiceClientCredentialFactory,
    createBotFrameworkAuthenticationFromConfiguration
} = require('botbuilder');

// OCRBotのインポート
const { AOAIOCRBot } = require('./bot');

// Restifyサーバーの作成
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${server.name} listening to ${server.url}`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo talk to your bot, open the emulator and select "Open Bot"');
});

// Bot Frameworkの認証情報をセットアップ
const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
    MicrosoftAppId: process.env.MicrosoftAppId,
    MicrosoftAppPassword: process.env.MicrosoftAppPassword,
    MicrosoftAppType: process.env.MicrosoftAppType,
    MicrosoftAppTenantId: process.env.MicrosoftAppTenantId
});

const botFrameworkAuthentication = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);

// アダプターの作成
const adapter = new CloudAdapter(botFrameworkAuthentication);

// エラーハンドリング
const onTurnErrorHandler = async (context, error) => {
    console.error(`\n [onTurnError] unhandled error: ${error}`);

    // Bot Framework Emulatorで表示されるTrace Activityを送信
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${error}`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // ユーザーにエラーメッセージを送信
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

// CloudAdapterのエラーハンドリングを設定
adapter.onTurnError = onTurnErrorHandler;

// OCRBotのインスタンスを作成（OpenAIの設定を含む）
const myBot = new AOAIOCRBot({
    openAiEndpoint: process.env.EndPoint,   // OpenAI APIのエンドポイント
    openAiApiKey: process.env.ApiKey,       // OpenAI APIのキー
    deploymentName: 'gpt4',                // 使用するモデル（gpt-4など）
});

// メッセージリクエストを処理
server.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, (context) => myBot.run(context));
});

// Streamingリクエスト用の処理
server.on('upgrade', async (req, socket, head) => {
    const streamingAdapter = new CloudAdapter(botFrameworkAuthentication);
    streamingAdapter.onTurnError = onTurnErrorHandler;
    await streamingAdapter.process(req, socket, head, (context) => myBot.run(context));
});