import ollama from 'ollama';

async function run() {
  try {
    const response = await ollama.chat({
      model: 'gpt-oss',
      messages: [{role: 'user', content: 'Hello!'}],
    });
    console.log(response.message.content);
  } catch (e) {
    console.error(e);
  }
}
run();
