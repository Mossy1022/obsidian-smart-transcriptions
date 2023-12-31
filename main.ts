import { App, Editor, MarkdownView, Modal, normalizePath, Notice, Plugin, PluginSettingTab, requestUrl,  RequestUrlParam, Setting, TAbstractFile } from 'obsidian';

interface AudioPluginSettings {
	model: string;
    apiKey: string;
	prompt: string;
}

let DEFAULT_SETTINGS: AudioPluginSettings = {
	model: 'gpt-3.5-turbo-16k',
    apiKey: '',
	prompt: 'You are an expert note-making AI. Notes will be added to Obsidian in markdown format where I have all my notes linked by categories, tags, etc. The following is a transcription of recording of someone talking aloud or people in a conversation. There may be a lot of random things that are said given fluidity of conversation or thought process and the microphone\'s ability to pick up all audio. Make an outline of all topics and points within a structured hierarchy. Then go into detail with summaries that explain things more eloquently. Finally, Create a mermaid chart code that complements the outline.  The following is the transcribed audio:\n\n'
}

interface TokenLimits {
    [key: string]: number;
  }
  
  const TOKEN_LIMITS: TokenLimits = {
      'gpt-3.5-turbo': 4096,
      'gpt-3.5-turbo-16k': 16000,
      'gpt-3.5-turbo-0301':4096,
      'text-davinci-003': 4097,
      'text-davinci-002': 4097,
      'code-davinci-002': 8001,
      'code-davinci-001': 8001,
      'gpt-4': 8192,
      'gpt-4-0314': 8192,
      'gpt-4-32k': 32768,
      'gpt-4-32k-0314': 32768
  }
  

export default class SmartTranscriptionsPlugin extends Plugin {
	settings: AudioPluginSettings;
	writing: boolean;

	apiKey: string = '';
    model: string = 'gpt-3.5-turbo-16k';

    // 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

	async onload() {
		console.log('loading plugin');

        new Notice('This is a Plugin notice!');


		await this.loadSettings();

		this.addRibbonIcon('dice', 'obsidian-smart-transcriptions-plugin', () => {
			new Notice('This is a notice!');

			// const view = this.app.workspace.getActiveViewOfType(EditorView);
			// const editor = view?.editor;
			// 			this.commandGenerateTranscript(editor);
		});

		this.addStatusBarItem().setText('Status Bar Text');

		this.addCommand({
			id: 'open-sample-modal',
			name: 'Generate Smart Transcript',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                this.commandGenerateTranscript(editor);
            }
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));

		this.registerCodeMirror((cm: CodeMirror.Editor) => {
			console.log('codemirror', cm);
		});

		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

        this.apiKey = this.settings.apiKey;
        this.model = this.settings.apiKey;


		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {
		console.log('unloading plugin');
	}

	writeText(editor: Editor, LnToWrite: number, text: string) {
        const newLine = this.getNextNewLine(editor, LnToWrite);
        editor.setLine(newLine, '\n' + text.trim() + '\n');
        return newLine;
    }

	getNextNewLine(editor: Editor, Ln: number) {
        let newLine = Ln;
        while (editor.getLine(newLine).trim().length > 0) {
            if (newLine == editor.lastLine()) editor.setLine(newLine, editor.getLine(newLine) + '\n');
            newLine++;
        }
        return newLine;
    }

	commandGenerateTranscript(editor: Editor) {
        const position = editor.getCursor();
        const text = editor.getRange({ line: 0, ch: 0 }, position);
        const regex = [/(?<=\[\[)(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=]])/g,
            /(?<=\[(.*)]\()(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=\))/g];
        this.findFilePath(text, regex).then((path) => {
            const fileType = path.split('.').pop();
            if (fileType == undefined || fileType == null || fileType == '') {
                new Notice('No audio file found');
            } else {
                this.app.vault.adapter.exists(path).then((exists) => {
                    if (!exists) throw new Error(path + ' does not exist');
                    this.app.vault.adapter.readBinary(path).then((audioBuffer) => {
                        if (this.writing) {
                            new Notice('Generator is already in progress.');
                            return;
                        }
                        this.writing = true;
                        new Notice("Generating transcript...");
                        this.generateTranscript(audioBuffer, fileType).then((result) => {

							// const selectedText = editor.getSelection();
							const prompt = this.settings.prompt + result;
							new Notice('Transcript Generated... Reformatting');
							this.generateText(prompt, editor , editor.getCursor('to').line);
                        }).catch(error => {
                            console.log(error.message);
                            new Notice(error.message);
                            this.writing = false;
                        });
                    });
                });
            }
        }).catch(error => {
            console.log(error.message);
            new Notice(error.message);
        });
    }

	commandGenerateText(editor: Editor, prompt: string) {
        const currentLn = editor.getCursor('to').line;
        if (this.writing) {
            new Notice('Generator is already in progress.');
            return;
        }
        this.writing = true;
        new Notice("Generating text...");
        this.generateText(prompt, editor, currentLn).then((text) => {
            new Notice("Text completed.");
            this.writing = false;
        }).catch(error => {
            console.log(error.message);
            new Notice(error.message);
            this.writing = false;
        });
    }

	async generateTranscript(audioBuffer: ArrayBuffer, filetype: string) {
        if (this.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

        // Reference: www.stackoverflow.com/questions/74276173/how-to-send-multipart-form-data-payload-with-typescript-obsidian-library
        const N = 16 // The length of our random boundry string
        const randomBoundryString = 'WebKitFormBoundary' + Array(N + 1).join((Math.random().toString(36) + '00000000000000000').slice(2, 18)).slice(0, N)
        const pre_string = `------${randomBoundryString}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: "application/octet-stream"\r\n\r\n`;
        const post_string = `\r\n------${randomBoundryString}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n------${randomBoundryString}--\r\n`
        const pre_string_encoded = new TextEncoder().encode(pre_string);
        const post_string_encoded = new TextEncoder().encode(post_string);
        const concatenated = await new Blob([pre_string_encoded, audioBuffer, post_string_encoded]).arrayBuffer()

        const options: RequestUrlParam = {
            url: 'https://api.openai.com/v1/audio/transcriptions',
            method: 'POST',
            contentType: `multipart/form-data; boundary=----${randomBoundryString}`,
            headers: {
                'Authorization': 'Bearer ' + this.apiKey
            },
            body: concatenated
        };

        
        const response = await requestUrl(options).catch((error) => { 
            if (error.message.includes('401')) throw new Error('OpenAI API Key is not valid.');
            else throw error; 
        });
        if ('text' in response.json) return response.json.text;
        else throw new Error('Error. ' + JSON.stringify(response.json));
    }

	async getAttachmentDir() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) throw new Error('No active file');
        const dir = this.app.vault.adapter.getResourcePath(activeFile.path).replace(activeFile.path, '');
        return dir;
    }

	async findFilePath(text: string, regex: RegExp[]) {
        const fullPath = await this.getAttachmentDir().then((attachmentPath) => {
            let filename = '';
            let result: RegExpExecArray | null;
            for (const reg of regex) {
                while ((result = reg.exec(text)) !== null) {
                    filename = normalizePath(decodeURI(result[0])).trim();
                }
            }

            if (filename == '') throw new Error('No file found in the text.');

            const fileInSpecificFolder = filename.contains('/');
            const AttInRootFolder = attachmentPath === '' || attachmentPath === '/';
            const AttInCurrentFolder = attachmentPath.startsWith('./');
            const AttInSpecificFolder = !AttInRootFolder && !AttInCurrentFolder;

            let fullPath = '';

            if (AttInRootFolder || fileInSpecificFolder) fullPath = filename;
            else {
                if (AttInSpecificFolder) fullPath = attachmentPath + '/' + filename;
                if (AttInCurrentFolder) {
                    const attFolder = attachmentPath.substring(2);
                    if (attFolder.length == 0) fullPath = this.getCurrentPath() + '/' + filename;
                    else fullPath = this.getCurrentPath() + '/' + attFolder + '/' + filename;
                }
            }

            const exists = this.app.vault.getAbstractFileByPath(fullPath) instanceof TAbstractFile;
            if (exists) return fullPath;
            else {
                let path = '';
                let found = false;
                this.app.vault.getFiles().forEach((file) => {
                    if (file.name === filename) {
                        path = file.path;
                        found = true;
                    }
                });
                if (found) return path;
                else throw new Error('File not found');
            }
        });
        return fullPath as string;
    }

	getCurrentPath() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) throw new Error('No active file');
        const currentPath = activeFile.path.split('/');
        currentPath.pop();
        const currentPathString = currentPath.join('/');
        return currentPathString;
    }

	async generateText(prompt: string, editor: Editor, currentLn: number, contextPrompt?: string) {
        if (prompt.length < 1) throw new Error('Cannot find prompt.');
        if (this.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

		if (prompt.length > TOKEN_LIMITS[this.settings.model]) {
			new Notice(`shortening prompt`);
			prompt = prompt.substring(prompt.length - (TOKEN_LIMITS[this.settings.model] + 300));
		}

		console.log('prompt: ', prompt);

		prompt = prompt + '.';

        let newPrompt = prompt;

        const messages = [];

        // messages.push({
		// 	role: 'system',
		// 	content: contextPrompt,
		// });

        messages.push({
            role: 'user',
            content: newPrompt,
        });

        const body = JSON.stringify({
            model: this.settings.model,
            messages: messages,
            stream: true
        });

		console.log('messages: ', messages);

		new Notice(`Starting reformat`);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            body: body,
            headers: {
                'Accept': 'text/event-stream',
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.apiKey,
            },
        });
        
        if (!response.ok) {
            const errorResponse = await response.json();
            const errorMessage = errorResponse && errorResponse.error.message ? errorResponse.error.message : response.statusText;
			new Notice(`Error. ${errorMessage}`);
            throw new Error(`Error. ${errorMessage}`);
        } else {
			new Notice(`Should work`);
		}

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body reader available');
        }

        let LnToWrite = this.getNextNewLine(editor, currentLn);
        editor.setLine(LnToWrite++, '\n');
        let end = false;
        let buffer = '';
        while (!end) {
            const { done, value } = await reader.read();
            end = done;
            const chunk = new TextDecoder().decode(value);
            const data = chunk.split('\n');

            for (const datum of data) {
                if (datum.trim() === 'data: [DONE]') {
                    end = true;
                    break;
                }
                if (datum.startsWith('data:')) {
                    const json = JSON.parse(datum.substring(6));
                    if ('error' in json) throw new Error('Error: ' + json.error.message);
                    if (!('choices' in json)) throw new Error('Error: ' + JSON.stringify(json));
                    if ('content' in json.choices[0].delta) {
                        const text = json.choices[0].delta.content;
                        if (buffer.length < 1) buffer += text.trim();
                        if (buffer.length > 0) {
                            const lines = text.split('\n');
                            if (lines.length > 1) {
                                for (const word of lines) {
                                    editor.setLine(LnToWrite, editor.getLine(LnToWrite++) + word + '\n');
                                }
                            } else {
                                editor.setLine(LnToWrite, editor.getLine(LnToWrite) + text);
                            }
                        }
                    }
                }
            }
        }
        editor.setLine(LnToWrite, editor.getLine(LnToWrite) + '\n');

		this.writing = false;
    }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class SampleSettingTab extends PluginSettingTab {
	plugin: SmartTranscriptionsPlugin;

	constructor(app: App, plugin: SmartTranscriptionsPlugin) {
		super(app, plugin);
		this.plugin = plugin;

        this.plugin.settings.prompt = 'You are an expert note-making AI. Notes will be added to Obsidian in markdown format where I have all my notes linked by categories, tags, etc. The following is a transcription of a recording of someone talking aloud or people in a conversation. There may be a lot of random things that are said given fluidity of conversation or thought process and the microphone\'s ability to pick up all audio. Make an outline of all topics and points within a structured hierarchy. Then go into detail with summaries that explain things more eloquently. Finally, Create a mermaid chart code that complements the outline.  The following is the transcribed audio:\n\n';
        this.plugin.settings.model = 'gpt-3.5-turbo-16k';
	}

	display(): void {
		let {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Smart Transcription Settings'});

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Ex: sk-ri9R4BotPJLjg0oilmZbC3BSbkFD1MZj2FWKfufrq1fdSuX3')
			.addText(text => text
				.setPlaceholder('YOUR API KEY')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					console.log('API Key: ' + value);
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

            new Setting(containerEl)
			.setName('Model')
			.setDesc('Select the model to use for note-generation')
			.addText(text => text
				.setPlaceholder(
                    'gpt-3.5-turbo-16k')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					console.log('API Key: ' + value);
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

        new Setting(containerEl)
			.setName('Custom Transcription-To-Notes Prompt')
			.setDesc('Prompt that will be sent to Chatpgt for trancribed audio.')
			.addTextArea(text => text
				.setPlaceholder(
                    'Act as my personal secretary and worlds greatest entreprenuer and know I will put these notes in my personal obsidian where I have all my notes linked by categories, tags, etc. The following is a transcription of recording of someone talking aloud or people in a conversation. May be a lot of random things that are said given fluidity of conversation and the microphone ability to pick up all audio. Make outline of all topics and points within a structured hierarchy. Make sure to include any quantifiable information said such as the cost of headphones being $400.  Then go into to detail with summaries that explain things more eloquently. Finally, Create a mermaid chart code that complements the outline.  The following is the transcribed audio:\n\n')
				.setValue(this.plugin.settings.prompt)
				.onChange(async (value) => {
					console.log('API Key: ' + value);
					this.plugin.settings.prompt = value;
					await this.plugin.saveSettings();
				}));
	}
}
