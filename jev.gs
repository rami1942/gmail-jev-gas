/**
 * 設定定数
 */
const CONFIG = {
  SEARCH_QUERY: 'label:nc',
  TARGET_LABEL: 'nc',
  LABEL_MARKETING: 'mm_trash',
  LABEL_OTHER: 'mm_keep',
  BATCH_SIZE: 10 // 1回あたりの処理スレッド上限
};

/**
 * メイン処理関数
 */
function organizeEmailsByJev() {
  const props = PropertiesService.getScriptProperties();
  const endpoint = props.getProperty('JEV_API_ENDPOINT');
  const apiKey = props.getProperty('JEV_API_KEY');

  if (!endpoint || !apiKey) {
    throw new Error('スクリプトプロパティに JEV_API_ENDPOINT または JEV_API_KEY が設定されていません。');
  }

  // ラベルオブジェクトの取得（未作成なら自動生成）
  const labelPnew = getOrCreateLabel(CONFIG.TARGET_LABEL);
  const labelMarketing = getOrCreateLabel(CONFIG.LABEL_MARKETING);
  const labelOther = getOrCreateLabel(CONFIG.LABEL_OTHER);

  // 対象スレッドを取得
  const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.BATCH_SIZE);
  if (threads.length === 0) {
    Logger.log('処理対象のメール（label:nc）はありません。');
    return;
  }

  threads.forEach(thread => {
    const messages = thread.getMessages();
    const latestMessage = messages[messages.length - 1];

    const subject = latestMessage.getSubject() || '(件名なし)';
    const from = latestMessage.getFrom() || '(送信者不明)';
    const plainBody = latestMessage.getPlainBody().substring(0, 1000); // 判定用に先頭1000文字

    // Jev API による分類判定
    const category = classifyEmailWithJev(subject, from, plainBody, endpoint, apiKey);
    Logger.log(`判定結果: [${category}] | 件名: ${subject}`);

    // ラベル付け替えおよび振り分け処理
    switch (category) {
      case 'marketing':
        thread.addLabel(labelMarketing);
        thread.removeLabel(labelPnew);
        break;

      case 'login':
        // ログイン通知はゴミ箱へ（ゴミ箱移動で受信トレイ・ラベル一覧から退避）
        thread.removeLabel(labelPnew);
        thread.moveToTrash();
        break;

      case 'other':
      default:
        thread.addLabel(labelOther);
        thread.removeLabel(labelPnew);
        break;
      case 'Error':
        break;
    }
  });

  Logger.log('振り分け処理が完了しました。');
}

function classifyEmailWithJev(subject, from, body, endpoint, apiKey) {
  const payload = {
    "state": `Sender: ${from}\nSubject: ${subject}\nBody:\n${body}`,
    "model": "jev-latest",
    "questions": {
      "category" : {
        "type": "choice",
        "instructions" : "Categorize this content.",
        "criteria" : {
          "marketing": "Sales, campaigns, promotions, newsletters, product information",
          "login": "Login notification",
          "other": "Other",
        }
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const res = UrlFetchApp.fetch(endpoint, options);
    const statusCode = res.getResponseCode();
    const resText = res.getContentText();
    // Logger.log(`res : ${resText}`);
    // res : {"model":"jev-1.13.0","answers":{"category":{"type":"choice","choice":"マーケティング","confidence":1.0,"probabilities":{"マーケティング":1.0,"それ以外":0.0,"ログイン通知":0.0}}},"usage":{"input_tokens":1229,"output_tokens":58}}

    if (statusCode >= 200 && statusCode < 300) {
      const data = JSON.parse(resText);
      let contentStr = data.answers.category.choice;

      if (data.answers.category.confidence < 0.5) {
        return 'other';
      }

      if (contentStr != null) {
        return contentStr;
      } else {
        return `other`;
      }

    } else {
      Logger.log(`Jev API Error (${statusCode}): ${resText}`);
    }
  } catch (err) {
    Logger.log(`エラー: ${err.message}`);
    return 'Error';
  }
}
/**
 * 指定名のラベルを取得、存在しない場合は作成
 */
function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}
