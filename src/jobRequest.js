export const buildJobFormData = (video, geminiApiKey) => {
    const formData = new FormData();
    formData.append('video', video);
    formData.append('geminiApiKey', geminiApiKey || '');
    return formData;
};
