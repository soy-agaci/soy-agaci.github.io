import * as d3 from 'd3';
import { D3Node } from '../../types/types';
import { UPLOAD_SCRIPT_URL, COLUMN_MAPPING } from './config';
import { getSupabaseClient } from '../../services/supabase/client';
import { uuid } from '../../utils/uuid';

// Declare Cropper global
declare class Cropper {
    constructor(element: HTMLImageElement, options: any);
    destroy(): void;
    getCroppedCanvas(options?: any): HTMLCanvasElement;
}

// Function to convert file to Base64
export function getBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]); // Remove data URI prefix
        reader.onerror = error => reject(error);
    });
}

export async function uploadPhotoAndGetUrl(file: File): Promise<string> {
    const path = `${uuid()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const storage = getSupabaseClient().storage.from('media');
    const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return storage.getPublicUrl(path).data.publicUrl;
}

export async function uploadPhoto(file: File, node: D3Node) {
    const statusEl = document.getElementById('save-status'); // Use save-status instead
    const sidebarImage = document.getElementById('sidebar-image') as HTMLImageElement;

    if (statusEl) {
        statusEl.innerText = "Yükleniyor...";
        statusEl.style.color = "orange";
    }

    try {
        if (!node) {
            throw new Error("Lütfen fotoğraf yüklemek için bir kişi seçin.");
        }

        const memberData = (node.added_data as any).input;
        let sheetRow: number;

        if (memberData && memberData.row_index) {
            sheetRow = memberData.row_index;
        } else if (node.data.startsWith("mem_")) {
            // Fallback for old IDs
            const memberId = parseInt(node.data.split("_")[1]);
            sheetRow = memberId + 2;
        } else {
            throw new Error("Kişi verisi veya satır numarası bulunamadı.");
        }

        const base64Data = await getBase64(file);

        const payload = {
            fileName: file.name,
            mimeType: file.type,
            fileData: base64Data,
            row: sheetRow,
            colIndex: COLUMN_MAPPING["image_path"] || 9 // Use hardcoded index
        };

        await fetch(UPLOAD_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // Use no-cors to avoid CORS errors, response will be opaque
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify(payload)
        });

        // Optimistic UI Update
        const temporaryImageUrl = URL.createObjectURL(file);

        // 1. Update Sidebar Image
        if (sidebarImage) {
            sidebarImage.src = temporaryImageUrl;
            sidebarImage.style.display = "inline-block";
        }

        // 2. Update Node Data
        if ((node.added_data as any).input) {
            (node.added_data as any).input.image_path = temporaryImageUrl;
        }

        // 3. Update Tree Node Image
        d3.selectAll<SVGGElement, D3Node>("g.node")
            .filter(d => d.data === node.data)
            .select("image")
            .attr("href", temporaryImageUrl);

        if (statusEl) {
            statusEl.innerText = "Yüklendi! (Kalıcı olması 5-10 dk sürebilir)";
            statusEl.style.color = "green";
            setTimeout(() => {
                statusEl.innerText = "";
            }, 5000);
        }

    } catch (error: any) {
        console.error("Fotoğraf yüklenirken hata oluştu:", error);
        if (statusEl) {
            statusEl.innerText = `Hata: ${error.message}`;
            statusEl.style.color = "red";
        } else {
            alert(`Hata: ${error.message}`);
        }
    } finally {
        // Clear the file input after upload attempt
        const input = document.getElementById('image-upload-input') as HTMLInputElement;
        if (input) input.value = '';
    }
}

export function initImageCropper(
    onCrop: (file: File) => void
) {
    let cropper: Cropper | null = null;
    const fileInput = document.getElementById('image-upload-input') as HTMLInputElement;
    const cropModal = document.getElementById('crop-modal');
    const cropImage = document.getElementById('image-to-crop') as HTMLImageElement;
    const btnCancelCrop = document.getElementById('btn-cancel-crop');
    const btnConfirmCrop = document.getElementById('btn-confirm-crop');

    if (!cropModal || !cropImage) return;

    // Helper to close modal
    const closeCropModal = () => {
        cropModal.style.display = "none";
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        if (fileInput) fileInput.value = ""; // Reset input
    };

    if (fileInput) {
        fileInput.addEventListener('change', (event: any) => {
            if (event.target.files.length > 0) {
                const file = event.target.files[0];

                // Read file to display in cropper
                const reader = new FileReader();
                reader.onload = (e: any) => {
                    cropImage.src = e.target.result;
                    cropModal.style.display = "flex"; // Show modal

                    // Init Cropper
                    if (cropper) cropper.destroy();
                    cropper = new Cropper(cropImage, {
                        aspectRatio: 1, // Square crop usually best for profiles
                        viewMode: 1,
                        autoCropArea: 0.8,
                    });
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (btnCancelCrop) {
        btnCancelCrop.addEventListener('click', closeCropModal);
    }

    if (btnConfirmCrop) {
        btnConfirmCrop.addEventListener('click', () => {
            if (!cropper) return;

            // Get cropped canvas
            cropper.getCroppedCanvas({
                width: 400, // Resize to reasonable size
                height: 400
            }).toBlob((blob: Blob | null) => {
                if (!blob) return;

                // Create a "File" object from the blob to pass to uploadPhoto
                const file = new File([blob], "cropped_image.jpg", { type: "image/jpeg" });
                onCrop(file);
                closeCropModal();
            }, 'image/jpeg', 0.9);
        });
    }
}
