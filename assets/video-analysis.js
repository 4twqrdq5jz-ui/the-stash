(() => {
  const MODEL_ID = "Xenova/clip-vit-base-patch32";
  const actions = [
    { name: "Kissing", prompt: "Two adults kissing." },
    { name: "Undressing", prompt: "An adult undressing." },
    { name: "Oral sex", prompt: "Adults engaging in oral sex." },
    { name: "Penetrative sex", prompt: "Adults having penetrative sex." },
    { name: "Masturbation", prompt: "An adult masturbating." },
    { name: "Touching and foreplay", prompt: "Adults touching and engaging in foreplay." },
    { name: "Dancing", prompt: "An adult dancing." },
    { name: "Posing for camera", prompt: "An adult posing for the camera." },
    { name: "Talking or interview", prompt: "Adults talking to the camera in an interview." },
    { name: "Solo performance", prompt: "An adult performing alone for the camera." },
    { name: "Group scene", prompt: "Several adults together in a sexual scene." },
    { name: "No clear action", prompt: "A frame that does not clearly show any of these actions." }
  ];
  let queue = Promise.resolve();

  async function analyze(grabber, categories, onProgress, cancelled){
    const task = queue.then(() => run(grabber, categories, onProgress, cancelled));
    queue = task.catch(() => {});
    return task;
  }

  async function run(grabber, categories, onProgress, cancelled){
    if (cancelled()) return { cancelled: true, categories: [], actions: [] };
    onProgress({ stage: "model" });
    const T = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm");
    const id = MODEL_ID;
    let tokenizer, textModel, processor, visionModel;
    try {
      [tokenizer, textModel, processor, visionModel] = await Promise.all([
        T.AutoTokenizer.from_pretrained(id),
        T.CLIPTextModelWithProjection.from_pretrained(id, { dtype: "q8" }),
        T.AutoProcessor.from_pretrained(id),
        T.CLIPVisionModelWithProjection.from_pretrained(id, { dtype: "q8" })
      ]);
      if (cancelled()) return { cancelled: true, categories: [], actions: [] };

      const categoryLabels = (categories || []).map(c => ({
        id: c.id,
        name: c.name,
        prompt: `An adult video scene categorized as ${c.name}.`
      }));
      const allLabels = [
        ...categoryLabels,
        { name: "No category match", prompt: "A video frame that does not match any of the listed categories." },
        ...actions
      ];
      const tokens = tokenizer(allLabels.map(label => label.prompt), { padding: "max_length", truncation: true });
      const textEmbeds = (await textModel(tokens)).text_embeds.normalize().tolist();
      const categoryCount = categoryLabels.length;
      const duration = await grabber.duration();
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("The video duration could not be read for analysis.");
      const count = Math.min(12, Math.max(4, Math.ceil(duration / 30)));
      const categoryTotals = new Array(categoryCount).fill(0), categoryWins = new Array(categoryCount).fill(0);
      const actionMarks = [];
      let previousAction = null;

      for (let i = 0; i < count; i++){
        if (cancelled()) return { cancelled: true, categories: [], actions: [] };
        const time = duration * (i + 0.5) / count;
        const frame = await grabber.grab(time);
        if (!frame) continue;
        const image = await T.RawImage.fromBlob(frame.blob);
        const imageEmbeds = (await visionModel(await processor(image))).image_embeds.normalize().tolist()[0];
        const logits = textEmbeds.map(embedding => 100 * T.dot(imageEmbeds, embedding));
        const categoryScores = T.softmax(logits.slice(0, categoryCount + 1));
        for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex++){
          categoryTotals[categoryIndex] += categoryScores[categoryIndex];
          if (categoryIndex === categoryScores.indexOf(Math.max(...categoryScores))) categoryWins[categoryIndex]++;
        }

        const actionOffset = categoryCount + 1;
        const actionScores = T.softmax(logits.slice(actionOffset));
        let bestActionIndex = 0;
        for (let j = 1; j < actionScores.length; j++) if (actionScores[j] > actionScores[bestActionIndex]) bestActionIndex = j;
        const bestAction = actions[bestActionIndex];
        const bestScore = actionScores[bestActionIndex];
        if (bestAction.name !== "No clear action" && bestScore >= 0.18 &&
            (!previousAction || previousAction.name !== bestAction.name || time - previousAction.time >= 60) &&
            actionMarks.length < 12){
          actionMarks.push({ name: bestAction.name, action_time: Math.round(time * 10) / 10 });
          previousAction = { name: bestAction.name, time };
        } else if (bestAction.name === "No clear action" || bestScore < 0.18){
          previousAction = null;
        }
        onProgress({ stage: "scan", current: i + 1, total: count });
      }

      const minVotes = Math.max(1, Math.ceil(count * 0.2));
      const suggestedCategories = categoryLabels.map((category, i) => ({
        id: category.id,
        score: categoryTotals[i] / count,
        votes: categoryWins[i]
      })).filter(category => category.score >= 0.16 && category.votes >= minVotes)
        .sort((a, b) => b.score - a.score).slice(0, 3).map(category => category.id);
      return { categories: suggestedCategories, actions: actionMarks };
    } finally {
      for (const model of [textModel, visionModel]){
        if (model && typeof model.dispose === "function") await model.dispose();
      }
    }
  }

  window.StashVideoAI = { analyze };
})();
