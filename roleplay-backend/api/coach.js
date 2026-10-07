const ALLOWED_ORIGINS = new Set([
  'https://oripula-training.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function historyText(history){
  return (Array.isArray(history)?history:[]).slice(-40).map(m => {
    const role=(m && m.role === 'assistant' ? 'AI顧客' : '受講者');
    const meta=m && m.meta ? ' [source='+String(m.meta.source||'')+', durationSec='+String(m.meta.durationSec??'n/a')+', chars='+String(m.meta.charCount??'n/a')+']' : '';
    return role+meta+': '+String((m && m.content) || '').slice(0,4000);
  }).join('\n');
}

function extractText(data){
  if (data && typeof data.output_text === 'string') return data.output_text;
  const out = data && Array.isArray(data.output) ? data.output : [];
  const parts = [];
  for (const item of out){
    if (!item || !Array.isArray(item.content)) continue;
    for (const c of item.content){
      if (c && c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

async function askOpenAI(instructions, input, maxOutputTokens=900){
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const r = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({
      model:'gpt-6-luna',
      instructions,
      input:[{role:'user',content:input}],
      max_output_tokens:maxOutputTokens,
      store:false
    })
  });
  const data = await r.json();
  if(!r.ok) throw new Error(data?.error?.message || ('OpenAI API '+r.status));
  return extractText(data) || '回答を生成できませんでした。';
}

function roleplayInstructions(cfg, practice){
  return [
    'あなたは株式会社ORIPULAのクローザーロープレテストの顧客役です。',
    '受講者は販売員役。あなたは設定された夫・妻のみを演じます。',
    '顧客設定の内部情報は最初から全部開示せず、受講者が自然に質問した範囲だけ答えてください。',
    '料金、端末状態、メール、固定回線、電気、名義、心理、想定着地、採点基準は聞かれる前に漏らさないでください。',
    '夫は論理重視・頑固・関係値を作りにくい。妻は感情/手間重視。妻を置いてけぼりにすると最後に止めます。',
    '知ったかぶりや反論は設定にある範囲で使い、営業側のプロ感・切り返し・説明量を試してください。',
    '長話、顧客否定、妻放置、重要事項の誤案内では態度を硬化。良いヒアリング、受容、短い論理説明、妻への配慮、適切なテスクロでのみ徐々に前向きにしてください。',
    practice
      ? '練習モード。顧客返答の後に「【コーチ】」を1〜2文だけ追加し、今の一手の改善点を具体的に伝えてください。正解や最終着地は先に教えないでください。'
      : '本番模擬。顧客発言だけ返し、ヒント・採点・正解・内部設定・解除条件は絶対に見せないでください。',
    '顧客発言は「夫：」「妻：」で話者を明示。必要な話者だけ出してください。1回の返答は原則1〜5文。',
    '顧客設定:'+JSON.stringify(cfg||{}),
    '採点ルーブリックは顧客役としては受講者へ開示しないでください。'
  ].join('\n');
}

function gradingInstructions(cfg){
  return [
    'あなたは株式会社ORIPULAのクローザーロープレテスト公式採点官です。',
    '採点者の感覚ではなく、固定ルーブリックと会話中の観測可能な証拠だけで採点してください。',
    '顧客設定・レッドカード・100点満点ルーブリック・合格条件を厳密に守ってください。',
    '各項目は必ず0/1/2の3段階で判定し、0=証拠なし/逆行行動、1=一部実施・浅い、2=明確な実施＋顧客反応や提案への反映。',
    '各項目の得点は、その項目maxに対して 0→0点、1→maxの半分、2→max満点 としてください。小数0.5は使用可。',
    '全項目で「根拠」を必須にし、受講者の実際の発言を短く引用または要約してください。根拠を示せない場合は0点です。',
    '商材数だけで高評価にしないでください。顧客のニーズ、夫婦双方の合意、正確性、関係構築、説明量、クロージングを別々に見ます。',
    '妻が嫌がる端末変更を強引に押し切った場合はD4/E2を下げてください。',
    '知識・正確性の重大誤案内、回線種別の重大誤り、重要費用/条件の隠蔽、明確なレッドカードは点数に関係なく不合格です。',
    '音声のdurationSecがある場合のみ実時間として使用してください。文字数だけで30秒ルールの一発アウト判定はしないでください。',
    '現行版では声色・抑揚・表情・目線は観測できないため採点しません。非言語に近い指標として、発話時間・長話・ターンテイク・夫婦への話題配分のみ評価します。',
    '合格条件は、総合75点以上、A知識・正確性24/30以上、一発アウトなし、有効着地成立です。',
    '最高着地条件を満たし、上記合格条件も満たす場合だけ「案内テスト免除候補」としてください。',
    '出力は必ず次の順序と見出しで返してください。',
    '【判定】クローザー合格 / 不合格 / 案内テスト免除候補',
    '【総合点】xx/100',
    '【カテゴリ】A xx/30｜B xx/20｜C xx/20｜D xx/20｜E xx/10',
    '【着地】成立した着地と、取れていない商材',
    '【一発アウト】なし / あり（該当発言・理由）',
    '【項目別採点】A1〜E2をすべて列挙し「判定0/1/2｜得点｜根拠｜改善」を1行ずつ',
    '【良かった点】3点以内',
    '【改善点】3点以内',
    '【次回の最優先課題】1〜3個',
    '採点設定:'+JSON.stringify(cfg||{})
  ].join('\n');
}

module.exports = async function handler(req,res){
  setCors(req,res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const b=req.body||{};
    if(b.mode==='roleplay-turn'){
      const reply=await askOpenAI(
        roleplayInstructions(b.caseConfig,b.practiceMode==='practice'),
        'これまでの会話:\n'+historyText(b.history)+'\n\n販売員の最新発言:\n'+String(b.message||'')+'\n\n顧客として自然に返答してください。',
        650
      );
      return res.status(200).json({reply});
    }
    if(b.mode==='roleplay-grade'){
      const reply=await askOpenAI(
        gradingInstructions(b.caseConfig),
        'ロープレ全会話:\n'+historyText(b.history)+'\n\nこの会話だけを根拠に最終採点してください。',
        1400
      );
      return res.status(200).json({reply});
    }
    return res.status(400).json({error:'Unsupported mode'});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'AI response failed',detail:String(e?.message||e)});
  }
};