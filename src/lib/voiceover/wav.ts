/** Minimal PCM16 WAV codec for the voice-over pipeline (mono-oriented, dependency-free). */

export interface DecodedWav {
	samples: Float32Array;
	sampleRate: number;
}

export function encodeWavPcm16Mono(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const bytes = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(bytes);
	const write = (offset: number, value: string) => {
		for (let index = 0; index < value.length; index++) {
			view.setUint8(offset + index, value.charCodeAt(index));
		}
	};
	write(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	write(8, "WAVE");
	write(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	write(36, "data");
	view.setUint32(40, samples.length * 2, true);
	for (let index = 0; index < samples.length; index++) {
		const value = Math.max(-1, Math.min(1, samples[index] || 0));
		view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
	}
	return bytes;
}

/**
 * Decodes a PCM16 WAV file (the format OpenAI TTS returns for `response_format: "wav"`).
 * Multi-channel input is downmixed to mono by averaging.
 */
export function decodeWavPcm16(bytes: ArrayBuffer): DecodedWav {
	const view = new DataView(bytes);
	const readTag = (offset: number) =>
		String.fromCharCode(
			view.getUint8(offset),
			view.getUint8(offset + 1),
			view.getUint8(offset + 2),
			view.getUint8(offset + 3),
		);
	if (bytes.byteLength < 44 || readTag(0) !== "RIFF" || readTag(8) !== "WAVE") {
		throw new Error("Not a RIFF/WAVE file");
	}

	let offset = 12;
	let format: {
		audioFormat: number;
		channels: number;
		sampleRate: number;
		bitsPerSample: number;
	} | null = null;
	while (offset + 8 <= bytes.byteLength) {
		const tag = readTag(offset);
		const chunkSize = view.getUint32(offset + 4, true);
		const dataStart = offset + 8;
		if (tag === "fmt ") {
			format = {
				audioFormat: view.getUint16(dataStart, true),
				channels: view.getUint16(dataStart + 2, true),
				sampleRate: view.getUint32(dataStart + 4, true),
				bitsPerSample: view.getUint16(dataStart + 14, true),
			};
		} else if (tag === "data") {
			if (!format) throw new Error("WAV data chunk appeared before fmt chunk");
			if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
				throw new Error(
					`Unsupported WAV encoding (format ${format.audioFormat}, ${format.bitsPerSample}-bit); expected PCM16`,
				);
			}
			const channels = Math.max(1, format.channels);
			const availableBytes = Math.min(chunkSize, bytes.byteLength - dataStart);
			const frameCount = Math.floor(availableBytes / 2 / channels);
			const samples = new Float32Array(frameCount);
			for (let frame = 0; frame < frameCount; frame++) {
				let sum = 0;
				for (let channel = 0; channel < channels; channel++) {
					sum += view.getInt16(dataStart + (frame * channels + channel) * 2, true);
				}
				samples[frame] = sum / channels / 0x8000;
			}
			return { samples, sampleRate: format.sampleRate };
		}
		// Chunks are word-aligned: odd sizes carry one padding byte.
		offset = dataStart + chunkSize + (chunkSize % 2);
	}
	throw new Error("WAV file has no data chunk");
}
