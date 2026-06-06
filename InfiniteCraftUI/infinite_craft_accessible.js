class AccessibleInfiniteCraft {
    constructor() {
        this.selectedElement = null;
        this.lockedElement = null;
        this.isProcessing = false;
        this.showNumbers = false;
        this.sortOrder = 'alphabetical';
        this.currentFilter = 'all';
        this.enableAnnouncements = true;
        
        // Combination statistics
        this.combinationStats = {
            total: 0,
            newElement: 0,
            sameElement: 0,
            nothing: 0,
            discovery: 0
        };

        // Section visibility states
        this.sectionStates = {
            stats: true,
            settings: true
        };
        
        // Load data from localStorage or use defaults
        this.loadGameData();
        
        this.initializeGame();
    }

    loadGameData() {
        try {
            const savedData = localStorage.getItem('infinitecraft-data');
            if (savedData) {
                const data = JSON.parse(savedData);
                this.elementsData = data.elementsData || [];
                this.discoveryCount = data.discoveryCount || 0;
                this.sortOrder = data.sortOrder || 'alphabetical';
                this.showNumbers = data.showNumbers || false;
                this.currentFilter = data.currentFilter || 'all';
                this.enableAnnouncements = data.enableAnnouncements !== false;
                this.combinationStats = data.combinationStats || {
                    total: 0,
                    newElement: 0,
                    sameElement: 0,
                    nothing: 0,
                    discovery: 0
                };
                this.sectionStates = data.sectionStates || {
                    stats: true,
                    settings: true
                };
                
                // If no saved data, use default elements
                if (this.elementsData.length === 0) {
                    this.initializeDefaultElements();
                }
            } else {
                this.initializeDefaultElements();
            }
        } catch (error) {
            console.error('Error loading game data:', error);
            this.initializeDefaultElements();
        }
    }

    initializeDefaultElements() {
        const defaultElements = ['Water', 'Fire', 'Wind', 'Earth'];
        this.elementsData = defaultElements.map((name, index) => ({
            name: name,
            timestamp: Date.now() - (defaultElements.length - index) * 1000,
            isDiscovery: false
        }));
        this.discoveryCount = 0;
    }

    saveGameData() {
        try {
            const dataToSave = {
                elementsData: this.elementsData,
                discoveryCount: this.discoveryCount,
                sortOrder: this.sortOrder,
                showNumbers: this.showNumbers,
                currentFilter: this.currentFilter,
                enableAnnouncements: this.enableAnnouncements,
                combinationStats: this.combinationStats,
                sectionStates: this.sectionStates
            };
            localStorage.setItem('infinitecraft-data', JSON.stringify(dataToSave));
        } catch (error) {
            console.error('Error saving game data:', error);
        }
    }

    saveDataToFile() {
        try {
            const dataToSave = {
                elementsData: this.elementsData,
                discoveryCount: this.discoveryCount,
                sortOrder: this.sortOrder,
                showNumbers: this.showNumbers,
                currentFilter: this.currentFilter,
                enableAnnouncements: this.enableAnnouncements,
                combinationStats: this.combinationStats,
                sectionStates: this.sectionStates,
                exportDate: new Date().toISOString()
            };
            
            const jsonString = JSON.stringify(dataToSave, null, 2);
            const blob = new Blob([jsonString], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `infinitecraft-save-${new Date().toISOString().split('T')[0]}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.announce('Game saved to file successfully!');
        } catch (error) {
            console.error('Error saving to file:', error);
            this.announce('Error saving game to file');
        }
    }

    loadDataFromFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                // Validate the data structure
                if (data.elementsData && Array.isArray(data.elementsData)) {
                    localStorage.setItem('infinitecraft-data', JSON.stringify(data));
                    location.reload();
                } else {
                    this.announce('Invalid save file format');
                }
            } catch (error) {
                console.error('Error loading file:', error);
                this.announce('Error loading save file');
            }
        };
        reader.readAsText(file);
    }

    restartGame() {
        // First save current data as backup
        this.saveDataToFile();
        
        // Clear localStorage
        localStorage.removeItem('infinitecraft-data');
        
        // Reload the page
        setTimeout(() => {
            location.reload();
        }, 1000);
    }

    initializeGame() {
        // Set UI controls to saved values
        document.getElementById('sort-select').value = this.sortOrder;
        document.getElementById('show-numbers').checked = this.showNumbers;
        document.getElementById('filter-select').value = this.currentFilter;
        document.getElementById('enable-announcements').checked = this.enableAnnouncements;
        
        // Set section states
        Object.keys(this.sectionStates).forEach(sectionId => {
            this.setSectionState(sectionId, this.sectionStates[sectionId]);
        });
        
        this.renderElements();
        this.updateStats();
        this.updateLockButton();
        
        // Add keyboard event listeners
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.clearSelection();
            } else if (e.ctrlKey && e.shiftKey && e.key === 'H') {
                e.preventDefault();
                this.toggleLock();
            }
        });
    }

    setSectionState(sectionId, expanded) {
        const header = document.querySelector(`[onclick*="${sectionId}"]`);
        const content = document.getElementById(`${sectionId}-content`);
        const arrow = header.querySelector('.collapsible-arrow');
        
        if (expanded) {
            content.classList.add('expanded');
            header.classList.add('expanded');
            arrow.textContent = '▲';
        } else {
            content.classList.remove('expanded');
            header.classList.remove('expanded');
            arrow.textContent = '▼';
        }
        
        this.sectionStates[sectionId] = expanded;
        this.saveGameData();
    }

    toggleSection(sectionId) {
        this.setSectionState(sectionId, !this.sectionStates[sectionId]);
    }

    getFilteredElements() {
        let filtered = [...this.elementsData];
        
        switch (this.currentFilter) {
            case 'discoveries':
                filtered = filtered.filter(el => el.isDiscovery);
                break;
            case 'non-discoveries':
                filtered = filtered.filter(el => !el.isDiscovery);
                break;
            case 'non-number-discoveries':
                filtered = filtered.filter(el => el.isDiscovery && !/\d/.test(el.name));
                break;
            case 'all':
            default:
                // No filtering
                break;
        }

        // Always keep the locked element in view, even when the active filter
        // would otherwise hide it. A locked element that gets filtered out
        // becomes impossible to see or unlock by clicking, which is how the
        // lock used to "disappear" when switching categories.
        if (this.lockedElement && !filtered.some(el => el.name === this.lockedElement)) {
            const lockedData = this.elementsData.find(el => el.name === this.lockedElement);
            if (lockedData) {
                filtered.push(lockedData);
            }
        }

        return filtered;
    }

    getSortedElements() {
        let sorted = this.getFilteredElements();
        
        switch (this.sortOrder) {
            case 'alphabetical':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'newest':
                sorted.sort((a, b) => b.timestamp - a.timestamp);
                break;
            case 'oldest':
                sorted.sort((a, b) => a.timestamp - b.timestamp);
                break;
        }
        
        return sorted;
    }

    updateFilterInfo() {
        const filterInfo = document.getElementById('filter-info');
        const filteredElements = this.getFilteredElements();
        
        if (this.currentFilter === 'all') {
            filterInfo.style.display = 'none';
        } else {
            filterInfo.style.display = 'block';
            filterInfo.textContent = `Showing ${filteredElements.length} of ${this.elementsData.length} elements`;
        }
    }

    renderElements() {
        const grid = document.getElementById('elements-grid');
        grid.innerHTML = '';
        
        const sortedElements = this.getSortedElements();
        this.updateFilterInfo();
        
        sortedElements.forEach((elementData) => {
            const button = document.createElement('button');
            button.className = 'element-button';
            button.setAttribute('aria-describedby', 'selection-status');
            
            // Add aria-selected for selected element
            if (this.selectedElement === elementData.name) {
                button.setAttribute('aria-selected', 'true');
                button.classList.add('selected');
            }
            
            // Add locked styling and attributes
            if (this.lockedElement === elementData.name) {
                button.classList.add('locked');
                button.setAttribute('aria-pressed', 'true');
            }
            
            button.onclick = () => this.selectElement(elementData.name, button);
            
            // Create button content
            let buttonContent = '';
            if (this.showNumbers) {
                // Find the element's stable number (based on chronological order)
                const chronologicalIndex = this.elementsData.findIndex(el => el.name === elementData.name);
                const elementNumber = chronologicalIndex + 1;
                buttonContent += `<span class="element-number">#${elementNumber}- </span>`;
            }
            
            buttonContent += elementData.name;
            
            if (elementData.isDiscovery) {
                buttonContent += `<span class="element-discovery"> (Discovery)</span>`;
            }
            
            if (this.lockedElement === elementData.name) {
                buttonContent += ` <strong>(LOCKED)</strong>`;
            }
            
            button.innerHTML = buttonContent;
            
            // Add keyboard support
            button.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.selectElement(elementData.name, button);
                }
            });
            
            grid.appendChild(button);
        });
    }

    selectElement(elementName, buttonElement) {
        if (this.isProcessing) return;

        if (this.lockedElement) {
            // If we have a locked element, always use it as first element
            if (elementName === this.lockedElement) {
                // Clicking the locked element - do nothing or maybe announce it's locked
                this.announce(`${elementName} is locked as the first element`);
                return;
            } else {
                // Attempt craft with locked element as first, clicked as second
                this.attemptCraft(this.lockedElement, elementName);
            }
        } else if (!this.selectedElement) {
            // First selection
            this.selectedElement = elementName;
            buttonElement.classList.add('selected');
            buttonElement.setAttribute('aria-selected', 'true');
            this.announce(`${elementName} selected`);
        } else {
            // Second selection - attempt craft
            this.attemptCraft(this.selectedElement, elementName);
        }
    }

    toggleLock() {
        // If an element is already locked, the lock control must always be
        // able to unlock it, regardless of the current selection or filter.
        // Unlocking previously required the locked element to also be the
        // *selected* element, but the selection is never set while locked
        // (and Escape clears it), so the lock could get permanently stuck.
        if (this.lockedElement) {
            this.announce(`${this.lockedElement} unlocked`);
            this.lockedElement = null;
            this.clearSelection();
            this.updateLockButton();
            this.renderElements();
            return;
        }

        // Nothing locked yet: lock whatever element is currently selected.
        if (!this.selectedElement) {
            this.announce('No element selected to lock');
            return;
        }

        this.lockedElement = this.selectedElement;
        this.announce(`${this.selectedElement} locked as first element`);
        this.updateLockButton();
        this.renderElements();
    }

    updateLockButton() {
        const lockButton = document.getElementById('lock-button');
        if (this.lockedElement) {
            lockButton.textContent = `Unlock ${this.lockedElement}`;
            lockButton.classList.add('locked');
        } else {
            lockButton.textContent = 'Lock Element';
            lockButton.classList.remove('locked');
        }
    }

    async attemptCraft(first, second) {
        if (this.isProcessing) return;
        
        this.isProcessing = true;
        this.showLoading(true);
        this.updateSelectionStatus(`Combining ${first} and ${second}...`);

        try {
            const response = await fetch(
                `https://neal.fun/api/infinite-craft/pair?ref=app&first=${encodeURIComponent(first).replaceAll('%20', '+')}&second=${encodeURIComponent(second).replaceAll('%20', '+')}`
            );
            
            if (!response.ok) {
                throw new Error('Failed to fetch from API');
            }
            
            const data = await response.json();
            this.processCraftResult(first, second, data);
            
        } catch (error) {
            console.error('Crafting error:', error);
            this.announce('Sorry, there was an error combining those elements. Please try again.');
            this.updateSelectionStatus('Error occurred. Please try again.');
        } finally {
            this.isProcessing = false;
            this.showLoading(false);
            if (!this.lockedElement) {
                this.clearSelection();
            }
        }
    }

    processCraftResult(first, second, data) {
        const result = data.result;
        const isNew = data.isNew;

        // Update combination statistics
        this.combinationStats.total++;

        if (!result || result.toLowerCase() === 'nothing') {
            // Failed combination
            this.combinationStats.nothing++;
            this.announce(`You combine ${first} and ${second}, but nothing happens.`);
            this.updateSelectionStatus(`${first} + ${second} = Nothing. Try different combinations!`);
            this.saveGameData();
            this.updateStats();
            return;
        }

        const alreadyHave = this.elementsData.some(element => element.name === result);
        
        if (!alreadyHave) {
            // New element for the player
            this.combinationStats.newElement++;
            const newElementData = {
                name: result,
                timestamp: Date.now(),
                isDiscovery: isNew
            };
            this.elementsData.push(newElementData);
            
            if (isNew) {
                this.discoveryCount++;
                this.combinationStats.discovery++;
            }
            
            this.saveGameData();
            this.renderElements();
            
            if (isNew) {
                // Global discovery
                this.announce(`You combine ${first} and ${second} and crafted ${result}. This is a brand new discovery that no one has ever made before!`);
                this.updateSelectionStatus(`SUCCESS! ${first} + ${second} = ${result} (NEW DISCOVERY!)`);
                this.highlightNewElement(result, true);
            } else {
                // New to player but discovered before
                this.announce(`You combine ${first} and ${second} and crafted ${result}.`);
                this.updateSelectionStatus(`SUCCESS! ${first} + ${second} = ${result} (New to you!)`);
                this.highlightNewElement(result, false);
            }
        } else {
            // Already have this element
            this.combinationStats.sameElement++;
            this.announce(`You combine ${first} and ${second} and crafted ${result}. You already have this element.`);
            this.updateSelectionStatus(`${first} + ${second} = ${result} (Already in collection)`);
        }

        this.saveGameData();
        this.updateStats();
    }

    highlightNewElement(elementName, isDiscovery) {
        // Find the button for the new element and highlight it
        setTimeout(() => {
            const buttons = document.querySelectorAll('.element-button');
            buttons.forEach(button => {
                const buttonText = button.textContent.replace(/^#\d+\s*/, '').replace('★ NEW! ', '').replace(' (Discovery)', '').replace(' (LOCKED)', '');
                if (buttonText === elementName) {
                    if (isDiscovery) {
                        button.classList.add('new-discovery');
                        // Remove the class after animation completes
                        setTimeout(() => {
                            button.classList.remove('new-discovery');
                        }, 2000);
                    } else {
                        button.style.background = 'linear-gradient(135deg, #9f7aea 0%, #805ad5 100%)';
                        setTimeout(() => {
                            button.style.background = '';
                        }, 2000);
                    }
                }
            });
        }, 100);
    }

    clearSelection() {
        const selectedButtons = document.querySelectorAll('.element-button.selected');
        selectedButtons.forEach(button => {
            button.classList.remove('selected');
            button.removeAttribute('aria-selected');
        });
        
        this.selectedElement = null;
        if (this.lockedElement) {
            this.updateSelectionStatus(`${this.lockedElement} is locked. Choose an element to combine with it.`);
        } else {
            this.updateSelectionStatus('No element selected. Choose your first element.');
        }
    }

    updateSelectionStatus(message) {
        document.getElementById('selection-status').textContent = message;
    }

    updateStats() {
        document.getElementById('element-count').textContent = this.elementsData.length;
        document.getElementById('discovery-count').textContent = this.discoveryCount;
        document.getElementById('total-combinations').textContent = this.combinationStats.total;
        
        const total = this.combinationStats.total;
        if (total > 0) {
            document.getElementById('new-element-rate').textContent = `${((this.combinationStats.newElement / total) * 100).toFixed(2)}%`;
            document.getElementById('same-element-rate').textContent = `${((this.combinationStats.sameElement / total) * 100).toFixed(2)}%`;
            document.getElementById('nothing-rate').textContent = `${Math.round((this.combinationStats.nothing / total) * 100).toFixed(2)}%`;
            document.getElementById('discovery-rate').textContent = `${((this.combinationStats.discovery / total) * 100)}%`;
        } else {
            document.getElementById('new-element-rate').textContent = '0%';
            document.getElementById('same-element-rate').textContent = '0%';
            document.getElementById('nothing-rate').textContent = '0%';
            document.getElementById('discovery-rate').textContent = '0%';
        }
    }

    announce(message) {
        if (!this.enableAnnouncements) return;
        
        const announcement = document.getElementById('announcement');
        announcement.textContent = message;
        
        // Clear after a moment to prepare for next announcement
        setTimeout(() => {
            announcement.textContent = '';
        }, 1000);
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (show) {
            loading.classList.add('show');
        } else {
            loading.classList.remove('show');
        }
    }

    changeSortOrder(newOrder) {
        this.sortOrder = newOrder || document.getElementById('sort-select').value;
        this.saveGameData();
        this.renderElements();
    }

    toggleNumbering() {
        this.showNumbers = document.getElementById('show-numbers').checked;
        this.saveGameData();
        this.renderElements();
    }

    changeFilter(newFilter) {
        this.currentFilter = newFilter || document.getElementById('filter-select').value;
        this.saveGameData();
        this.renderElements();
    }

    toggleAnnouncements() {
        this.enableAnnouncements = document.getElementById('enable-announcements').checked;
        this.saveGameData();
        this.announce(this.enableAnnouncements ? 'Announcements enabled' : 'Announcements disabled');
    }
}

// Global functions for the UI controls
function clearSelection() {
    if (window.game) {
        window.game.clearSelection();
    }
}

function changeSortOrder() {
    if (window.game) {
        window.game.changeSortOrder();
    }
}

function toggleNumbering() {
    if (window.game) {
        window.game.toggleNumbering();
    }
}

function changeFilter() {
    if (window.game) {
        window.game.changeFilter();
    }
}

function toggleLock() {
    if (window.game) {
        window.game.toggleLock();
    }
}

function toggleAnnouncements() {
    if (window.game) {
        window.game.toggleAnnouncements();
    }
}

function toggleSection(sectionId) {
    if (window.game) {
        window.game.toggleSection(sectionId);
    }
}

function handleCollapsibleKey(event, sectionId) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleSection(sectionId);
    }
}

function saveData() {
    if (window.game) {
        window.game.saveDataToFile();
    }
}

function loadData(event) {
    if (window.game) {
        window.game.loadDataFromFile(event);
    }
}

function showRestartModal() {
    document.getElementById('restart-modal').classList.add('show');
}

function hideRestartModal() {
    document.getElementById('restart-modal').classList.remove('show');
}

function confirmRestart() {
    if (window.game) {
        hideRestartModal();
        window.game.restartGame();
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new AccessibleInfiniteCraft();
});
