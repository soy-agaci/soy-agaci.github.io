import { D3Node } from '../../types/types';
import { store } from '../../services/state/store';
import { submitNewChild, submitNewSpouse, submitMoveChild } from './actions';
import { setPendingChildPhoto, currentEditedNode } from './state';

export function renderFormFields(container: HTMLElement, data: any) {
    const fieldsToEdit = [
        { key: "first_name", label: "Ad", type: "text" },
        { key: "last_name", label: "Soyad", type: "text" },
        {
            key: "gender", label: "Cinsiyet", type: "select", options: [
                { value: "E", label: "Erkek" },
                { value: "K", label: "Kadın" },
                { value: "U", label: "Belirsiz" }
            ]
        },
        { key: "birth_date", label: "Doğum Tarihi", type: "text" },
        { key: "birthplace", label: "Doğum Yeri", type: "text" },
        { key: "death_date", label: "Ölüm Tarihi", type: "text" },
        { key: "marriage", label: "Evlilik Tarihi", type: "text" },
        { key: "note", label: "Not", type: "text" }
    ];

    let html = `<div class="edit-form">`;
    fieldsToEdit.forEach((field: any) => {
        const value = data[field.key] || "";

        html += `<div class="info-row">`;

        if (field.type === "select") {
            html += `<select class="sidebar-input" data-key="${field.key}">
                        <option value="" disabled ${value === "" ? "selected" : ""}>${field.label}</option>`;
            field.options.forEach((opt: any) => {
                const selected = value === opt.value ? 'selected' : '';
                html += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
            });
            html += `</select>`;
        } else {
            html += `<input type="text" class="sidebar-input" data-key="${field.key}" value="${value}" placeholder="${field.label}">`;
        }

        html += `
            </div>
         `;
    });
    html += `</div>`;
    container.innerHTML = html;
}

export function showAddChildForm(node: D3Node) {
    const titleEl = document.getElementById('sidebar-title');
    const detailsEl = document.getElementById('sidebar-details');
    const imageEl = document.getElementById('sidebar-image') as HTMLImageElement;

    if (!detailsEl || !imageEl || !titleEl) return;

    // Show placeholder image for new child
    const placeholder = "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png";
    imageEl.src = placeholder;
    imageEl.style.display = "inline-block";
    imageEl.style.cursor = "pointer";
    imageEl.title = "Fotoğraf eklemek için tıklayın";

    // Reset pending photo
    setPendingChildPhoto(null);

    // Clear upload status from previous operations (if any)
    const statusEl = document.getElementById('save-status');
    if (statusEl) statusEl.innerText = "";

    // Hide delete photo button (no photo yet for new child)
    const deletePhotoBtn = document.getElementById('delete-photo-btn');
    if (deletePhotoBtn) deletePhotoBtn.style.display = "none";

    // Set a flag that we're in "add child" mode
    imageEl.dataset.addChildMode = "true";
    imageEl.dataset.deletePhoto = "false";

    // Click image to select photo (use normal flow with cropper)
    imageEl.onclick = () => {
        const input = document.getElementById('image-upload-input');
        if (input) input.click();
    };

    // Set Title
    titleEl.innerText = "Yeni Çocuk Ekle";

    // Pre-fill Data
    const parentSurname = (node.added_data as any).input.last_name || "";
    const emptyData = { last_name: parentSurname };

    // Render Form
    renderFormFields(detailsEl, emptyData);

    // Add Buttons
    const btnContainer = document.createElement("div");
    btnContainer.style.marginTop = "15px";
    btnContainer.style.display = "flex";
    btnContainer.style.justifyContent = "space-between";

    const btnCancel = document.createElement("button");
    btnCancel.className = "action-btn btn-secondary";
    btnCancel.innerText = "İptal";
    btnCancel.onclick = () => {
        // Revert to Edit Mode
        if (typeof currentEditedNode !== 'undefined') {
            const sidebar = document.getElementById('family-sidebar');
            if (sidebar) sidebar.classList.remove('active');
        }
    };

    const btnConfirm = document.createElement("button");
    btnConfirm.className = "action-btn btn-success";
    btnConfirm.innerText = "✅ Çocuğu Ekle";
    btnConfirm.onclick = () => submitNewChild(node);

    btnContainer.appendChild(btnCancel);
    btnContainer.appendChild(btnConfirm);
    detailsEl.appendChild(btnContainer);

    // Add Status Area
    const status = document.createElement("div");
    status.id = "add-status";
    status.style.marginTop = "10px";
    status.style.textAlign = "center";
    status.style.fontSize = "0.9em";
    detailsEl.appendChild(status);
}

export function showAddSpouseForm(node: D3Node) {
    const titleEl = document.getElementById('sidebar-title');
    const detailsEl = document.getElementById('sidebar-details');
    const imageEl = document.getElementById('sidebar-image') as HTMLImageElement;

    if (!detailsEl || !imageEl || !titleEl) return;

    // Show placeholder image for new spouse
    const placeholder = "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png";
    imageEl.src = placeholder;
    imageEl.style.display = "inline-block";
    imageEl.style.cursor = "pointer";
    imageEl.title = "Fotoğraf eklemek için tıklayın";

    // Reset pending photo
    setPendingChildPhoto(null);

    // Clear upload status from previous operations (if any)
    const statusEl = document.getElementById('save-status');
    if (statusEl) statusEl.innerText = "";

    // Hide delete photo button (no photo yet for new spouse)
    const deletePhotoBtn = document.getElementById('delete-photo-btn');
    if (deletePhotoBtn) deletePhotoBtn.style.display = "none";

    // Set a flag that we're in "add spouse" mode
    imageEl.dataset.addSpouseMode = "true"; // New flag for spouse
    imageEl.dataset.deletePhoto = "false";

    // Click image to select photo (use normal flow with cropper)
    imageEl.onclick = () => {
        const input = document.getElementById('image-upload-input');
        if (input) input.click();
    };

    // Set Title
    titleEl.innerText = "Yeni Eş Ekle";

    // Pre-fill Data
    const spouseSurname = (node.added_data as any).input.last_name || ""; // Spouse takes same surname initially
    const emptyData = { last_name: spouseSurname };

    // Render Form
    renderFormFields(detailsEl, emptyData);

    // Add Buttons
    const btnContainer = document.createElement("div");
    btnContainer.style.marginTop = "15px";
    btnContainer.style.display = "flex";
    btnContainer.style.justifyContent = "space-between";

    const btnCancel = document.createElement("button");
    btnCancel.className = "action-btn btn-secondary";
    btnCancel.innerText = "İptal";
    btnCancel.onclick = () => {
        if (typeof currentEditedNode !== 'undefined') {
            const sidebar = document.getElementById('family-sidebar');
            if (sidebar) sidebar.classList.remove('active');
        }
    };

    const btnConfirm = document.createElement("button");
    btnConfirm.className = "action-btn btn-success";
    btnConfirm.innerText = "✅ Eşi Ekle";
    btnConfirm.onclick = () => submitNewSpouse(node);

    btnContainer.appendChild(btnCancel);
    btnContainer.appendChild(btnConfirm);
    detailsEl.appendChild(btnContainer);

    // Add Status Area (re-use add-status or create a new one if needed)
    const status = document.createElement("div");
    status.id = "add-status"; // Re-using the same status div as for child
    status.style.marginTop = "10px";
    status.style.textAlign = "center";
    status.style.fontSize = "0.9em";
    detailsEl.appendChild(status);
}

export function showMoveChildForm(node: D3Node) {
    const titleEl = document.getElementById('sidebar-title');
    const detailsEl = document.getElementById('sidebar-details');
    const imageEl = document.getElementById('sidebar-image') as HTMLImageElement;

    if (!detailsEl || !imageEl || !titleEl) return;

    titleEl.innerText = "Ebeveyn Değiştir";
    detailsEl.innerHTML = "";

    const familyData = store.getState().familyData;
    const memberData = (node.added_data as any).input;

    // Determine current primary parent
    let currentPrimaryParent: any = null;

    if (familyData && familyData.members) {
        const fatherName = memberData?.father;
        const motherName = memberData?.mother;

        for (const [, member] of Object.entries(familyData.members)) {
            const m = member as any;
            if (!m.is_spouse) {
                if ((m.first_name === fatherName && m.gender === 'E') ||
                    (m.first_name === motherName && m.gender === 'K')) {
                    currentPrimaryParent = m;
                    break;
                }
            }
        }
    }

    const container = document.createElement("div");
    container.className = "edit-form";

    // Radio buttons for flow selection
    const flowGroup = document.createElement("div");
    flowGroup.style.marginBottom = "20px";
    flowGroup.innerHTML = `
        <label style="display:block; margin-bottom:10px; font-weight:bold;">Ne yapmak istiyorsunuz?</label>
        <div style="margin-bottom:8px;">
            <input type="radio" id="change-spouse" name="move-flow" value="spouse" checked>
            <label for="change-spouse" style="margin-left:5px;">Sadece eş ismini değiştir</label>
        </div>
        <div>
            <input type="radio" id="change-primary" name="move-flow" value="primary">
            <label for="change-primary" style="margin-left:5px;">Ana ebeveynini değiştir (taşı)</label>
        </div>
    `;
    container.appendChild(flowGroup);

    // Spouse change container
    const spouseChangeContainer = document.createElement("div");
    spouseChangeContainer.id = "spouse-change-container";

    if (currentPrimaryParent) {
        const parentInfo = document.createElement("div");
        parentInfo.style.marginBottom = "10px";
        parentInfo.innerHTML = `<strong>Ana Ebeveyn:</strong> ${currentPrimaryParent.first_name} ${currentPrimaryParent.last_name || ''}`;
        spouseChangeContainer.appendChild(parentInfo);
    }

    const spouseSelectGroup = document.createElement("div");
    spouseSelectGroup.className = "info-row";
    spouseSelectGroup.innerHTML = `<label style="display:block; margin-bottom:5px; font-weight:bold;">Yeni Eş:</label>`;

    const spouseOnlySelect = document.createElement("select");
    spouseOnlySelect.className = "sidebar-input";
    spouseOnlySelect.id = "spouse-only-select";
    spouseOnlySelect.innerHTML = `<option value="">(Yok / Bilinmiyor)</option>`;

    if (familyData && familyData.members && currentPrimaryParent && currentPrimaryParent.row_index) {
        // Build row map
        const rowMap = new Map<number, any>();
        Object.values(familyData.members).forEach((m: any) => {
            if (m.row_index) rowMap.set(m.row_index, m);
        });

        // Find spouses: they are rows immediately after parent with is_spouse=true
        let checkRow = currentPrimaryParent.row_index + 1;
        while (true) {
            const nextMem = rowMap.get(checkRow);
            if (!nextMem) break;

            if (nextMem.is_spouse) {
                const option = document.createElement("option");
                option.value = nextMem.first_name;
                option.innerText = `${nextMem.first_name} ${nextMem.last_name || ''}`;
                spouseOnlySelect.appendChild(option);
                checkRow++;
            } else {
                // Hit a non-spouse, stop looking
                break;
            }
        }
    }

    spouseSelectGroup.appendChild(spouseOnlySelect);
    spouseChangeContainer.appendChild(spouseSelectGroup);
    container.appendChild(spouseChangeContainer);

    // Primary parent change container
    const primaryChangeContainer = document.createElement("div");
    primaryChangeContainer.id = "primary-change-container";
    primaryChangeContainer.style.display = "none";

    const potentialParents: any[] = [];
    if (familyData && familyData.members) {
        Object.values(familyData.members).forEach((m: any) => {
            if (m.id !== node.data && !m.is_spouse) {
                potentialParents.push(m);
            }
        });
    }
    potentialParents.sort((a, b) => (a.first_name + " " + (a.last_name || "")).localeCompare(b.first_name + " " + (b.last_name || "")));

    const primaryParentGroup = document.createElement("div");
    primaryParentGroup.className = "info-row";
    primaryParentGroup.innerHTML = `<label style="display:block; margin-bottom:5px; font-weight:bold;">Yeni Ana Ebeveyn:</label>`;

    const primaryParentSelect = document.createElement("select");
    primaryParentSelect.className = "sidebar-input";
    primaryParentSelect.id = "primary-parent-select";
    primaryParentSelect.innerHTML = `<option value="" disabled selected>Seçiniz...</option>`;

    potentialParents.forEach(p => {
        const option = document.createElement("option");
        option.value = p.id;
        option.innerText = `${p.first_name} ${p.last_name || ''}${p.birth_date ? ` (${p.birth_date})` : ''}`;
        primaryParentSelect.appendChild(option);
    });

    primaryParentGroup.appendChild(primaryParentSelect);
    primaryChangeContainer.appendChild(primaryParentGroup);

    const newSpouseGroup = document.createElement("div");
    newSpouseGroup.className = "info-row";
    newSpouseGroup.style.marginTop = "15px";
    newSpouseGroup.innerHTML = `<label style="display:block; margin-bottom:5px; font-weight:bold;">Eş:</label>`;

    const newSpouseSelect = document.createElement("select");
    newSpouseSelect.className = "sidebar-input";
    newSpouseSelect.id = "new-spouse-select";
    newSpouseSelect.disabled = true;
    newSpouseSelect.innerHTML = `<option value="" selected>Önce Ana Ebeveyn Seçin</option>`;

    newSpouseGroup.appendChild(newSpouseSelect);
    primaryChangeContainer.appendChild(newSpouseGroup);

    primaryParentSelect.onchange = () => {
        const selectedParentId = primaryParentSelect.value;
        newSpouseSelect.innerHTML = `<option value="">(Yok / Bilinmiyor)</option>`;
        newSpouseSelect.disabled = false;

        if (familyData && familyData.members && selectedParentId) {
            const selectedParent = familyData.members[selectedParentId] as any;
            if (selectedParent && selectedParent.row_index) {
                // Build row map to find spouses
                const rowMap = new Map<number, any>();
                Object.values(familyData.members).forEach((m: any) => {
                    if (m.row_index) rowMap.set(m.row_index, m);
                });

                // Find spouses: they are rows immediately after parent with is_spouse=true
                let checkRow = selectedParent.row_index + 1;
                while (true) {
                    const nextMem = rowMap.get(checkRow);
                    if (!nextMem) break;

                    if (nextMem.is_spouse) {
                        const option = document.createElement("option");
                        option.value = nextMem.first_name;
                        option.innerText = `${nextMem.first_name} ${nextMem.last_name || ''}`;
                        newSpouseSelect.appendChild(option);
                        checkRow++;
                    } else {
                        // Hit a non-spouse, stop looking
                        break;
                    }
                }
            }
        }
    };

    container.appendChild(primaryChangeContainer);
    detailsEl.appendChild(container);

    // Radio button handler
    const radioButtons = container.querySelectorAll('input[name="move-flow"]');
    radioButtons.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const value = (e.target as HTMLInputElement).value;
            if (value === 'spouse') {
                spouseChangeContainer.style.display = 'block';
                primaryChangeContainer.style.display = 'none';
            } else {
                spouseChangeContainer.style.display = 'none';
                primaryChangeContainer.style.display = 'block';
            }
        });
    });

    // Buttons
    const btnContainer = document.createElement("div");
    btnContainer.style.marginTop = "15px";
    btnContainer.style.display = "flex";
    btnContainer.style.justifyContent = "space-between";

    const btnCancel = document.createElement("button");
    btnCancel.className = "action-btn btn-secondary";
    btnCancel.innerText = "İptal";
    btnCancel.onclick = () => {
        const sidebar = document.getElementById('family-sidebar');
        if (sidebar) sidebar.classList.remove('active');
    };

    const btnConfirm = document.createElement("button");
    btnConfirm.className = "action-btn btn-success";
    btnConfirm.innerText = "✅ Güncelle";
    btnConfirm.onclick = () => {
        const selectedFlow = (container.querySelector('input[name="move-flow"]:checked') as HTMLInputElement)?.value;

        if (selectedFlow === 'spouse') {
            const newSpouseName = spouseOnlySelect.value;
            submitMoveChild(node, null, newSpouseName, 'spouse', currentPrimaryParent);
        } else {
            const newPrimaryParentId = primaryParentSelect.value;
            const newSpouseName = newSpouseSelect.value;

            if (!newPrimaryParentId) {
                alert("Lütfen yeni ana ebeveyn seçin.");
                return;
            }
            submitMoveChild(node, newPrimaryParentId, newSpouseName, 'primary', null);
        }
    };

    btnContainer.appendChild(btnCancel);
    btnContainer.appendChild(btnConfirm);
    detailsEl.appendChild(btnContainer);

    const status = document.createElement("div");
    status.id = "move-status";
    status.style.marginTop = "10px";
    status.style.textAlign = "center";
    detailsEl.appendChild(status);
}
