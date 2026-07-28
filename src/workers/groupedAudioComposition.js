export const buildGroupedNarrationAudioComposition = (authTimeline, videoDuration) => {
    const audioFilters = [];
    const audioInputs = [];
    const groupMappings = [];
    const segmentMappings = [];
    const MAX_TTS_TEMPO = 1.25;
    let previousSegmentEnd = 0;

    for (let groupIndex = 0; groupIndex < authTimeline.length; groupIndex++) {
        const group = authTimeline[groupIndex];
        if (!Array.isArray(group.segments) || group.segments.length === 0) {
            throw new Error(`Pipeline Error: TTS group ${groupIndex} has no authoritative segments.`);
        }

        const mappedSegments = [];
        for (const segment of group.segments) {
            const segmentIndex = segment.index;
            const sourceStart = segment.final_audio_start;
            const sourceEnd = segment.final_audio_end;
            const sourceDuration = sourceEnd - sourceStart;
            const targetStart = Math.max(0, segment.orig_start);
            const targetEnd = Math.min(videoDuration, segment.orig_end);
            const targetDuration = targetEnd - targetStart;
            if (![sourceStart, sourceEnd, sourceDuration, targetStart, targetEnd, targetDuration].every(Number.isFinite) ||
                sourceDuration <= 0 || targetDuration <= 0 ||
                !['dialogue', 'narration'].includes(segment.kind) ||
                (segment.kind === 'dialogue' && !segment.speaker) ||
                typeof segment.text !== 'string' || segment.text.trim().length === 0) {
                throw new Error(`Pipeline Error: Invalid TTS segment ${segmentIndex} in group ${groupIndex}.`);
            }
            if (targetStart < previousSegmentEnd - 0.000001) {
                throw new Error(
                    `Pipeline Error: TTS segment ${segmentIndex} overlaps the previous segment ` +
                    `(${targetStart.toFixed(6)} < ${previousSegmentEnd.toFixed(6)}).`
                );
            }

            const requiredTempo = sourceDuration / targetDuration;
            const tempo = Math.max(1, requiredTempo);
            const delayMs = Math.round(targetStart * 1000);
            const outputLabel = `tts_g${groupIndex}_s${segmentIndex}`;
            audioFilters.push(
                `[1:a]atrim=start=${sourceStart.toFixed(6)}:end=${sourceEnd.toFixed(6)},` +
                `asetpts=PTS-STARTPTS,aresample=async=1,atempo=${tempo.toFixed(6)},` +
                `apad,atrim=duration=${targetDuration.toFixed(6)},` +
                `adelay=${delayMs}:all=1[${outputLabel}]`
            );
            audioInputs.push(`[${outputLabel}]`);
            const mapping = {
                group_index: groupIndex,
                segment_index: segmentIndex,
                text: segment.text,
                kind: segment.kind,
                speaker: segment.speaker || null,
                orig_start: targetStart,
                orig_end: targetEnd,
                generated_duration: sourceDuration,
                ffmpeg_input: 1,
                final_placement_timestamp: targetStart,
                source_start: sourceStart,
                source_duration: sourceDuration,
                target_start: targetStart,
                target_duration: targetDuration,
                tempo,
                output_label: outputLabel
            };
            segmentMappings.push(mapping);
            mappedSegments.push(mapping);
            previousSegmentEnd = targetEnd;
        }
        groupMappings.push({
            group_index: groupIndex,
            text: group.text,
            segment_count: mappedSegments.length,
            segments: mappedSegments
        });
    }

    audioFilters.push(`[2:a]atrim=duration=${videoDuration.toFixed(6)}[silence]`);
    audioInputs.push('[silence]');
    audioFilters.push(
        `${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=longest:normalize=0,` +
        'loudnorm=I=-14:LRA=11:TP=-1.5[aout]'
    );
    return {
        filterComplex: audioFilters.join(';'),
        groupMappings,
        segmentMappings,
        maxTempo: MAX_TTS_TEMPO
    };
};
