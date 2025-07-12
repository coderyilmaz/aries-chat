class ChatApp {
    constructor() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this.accessToken = null;
        this.refreshToken = null;
        this.users = [];
        this.filteredUsers = [];
        this.selectedUser = null;
        this.currentConversation = null;
        this.messages = [];
        this.socket = null;
        this.typingTimer = null;
        this.typingTimeoutId = null;
        this.sessionId = this.generateUUID();
        this.isMobile = window.innerWidth < 768;
        this.selectedFile = null;
        this.selectedMessages = new Set();
        this.isSelectionMode = false;
        this.pendingMessages = new Map();
        this.messageDeduplication = new Set();


        this.settings = {
            theme: localStorage.getItem('theme') || 'system',
            chatBackground: localStorage.getItem('chatBackground') || 'default',
            customBackground: localStorage.getItem('customBackground') || null
        };


        this.apiUrl = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'http://localhost:3000';

        this.init();
    }

    generateUUID() {
        return crypto.randomUUID();
    }


    fixBase64Format(base64String) {
        if (!base64String || typeof base64String !== 'string') {
            return base64String;
        }

        if (base64String.startsWith('data:') && !base64String.includes(';base64,')) {
            if (base64String.includes('base64,')) {
                return base64String.replace('base64,', ';base64,');
            }
        }

        return base64String;
    }

    async init() {
        this.applyTheme();

        this.setupEventListeners();
        this.setupMobileEventListeners();

        this.accessToken = localStorage.getItem('accessToken');
        this.refreshToken = localStorage.getItem('refreshToken');

        if (this.accessToken && this.refreshToken) {
            try {
                const response = await this.apiCall('/api/auth/me');
                if (response.success) {
                    this.currentUser = response.data.user;
                    this.isAuthenticated = true;
                    await this.initializeApp();
                } else {
                    this.clearAuth();
                }
            } catch (error) {
                this.clearAuth();
            }
        }

        this.hideLoading();
        this.showAuthIfNeeded();

        window.addEventListener('resize', () => {
            this.isMobile = window.innerWidth < 768;
            if (!this.isMobile) {
                this.closeMobileSidebar();
            }
        });
    }

    setupEventListeners() {
        document.getElementById('loginTab').addEventListener('click', () => this.switchAuthMode('login'));
        document.getElementById('registerTab').addEventListener('click', () => this.switchAuthMode('register'));

        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('registerForm').addEventListener('submit', (e) => this.handleRegister(e));

        document.getElementById('togglePassword').addEventListener('click', this.togglePasswordVisibility);

        document.getElementById('userSearch').addEventListener('input', () => this.filterUsers());

        document.getElementById('messageForm').addEventListener('submit', (e) => this.handleSendMessage(e));
        document.getElementById('messageText').addEventListener('input', () => this.handleTyping());

        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileSelect(e));
        document.getElementById('removeFile').addEventListener('click', () => this.removeSelectedFile());

        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('profileBtn').addEventListener('click', () => this.openProfileModal());
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettingsModal());
        document.getElementById('darkModeToggle').addEventListener('click', () => this.toggleDarkMode());

        document.getElementById('userMenuBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('userDropdown');
            dropdown.classList.toggle('hidden');
        });

        document.getElementById('closeProfileModal').addEventListener('click', () => this.closeProfileModal());
        document.getElementById('cancelProfileEdit').addEventListener('click', () => this.closeProfileModal());
        document.getElementById('profileForm').addEventListener('submit', (e) => this.handleProfileUpdate(e));
        document.getElementById('profileAvatar').addEventListener('click', () => document.getElementById('avatarInput').click());
        document.getElementById('avatarInput').addEventListener('change', (e) => this.handleAvatarUpload(e));

        document.getElementById('closeSettingsModal').addEventListener('click', () => this.closeSettingsModal());
        document.querySelectorAll('input[name="theme"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.changeTheme(e.target.value));
        });
        document.querySelectorAll('.chat-bg-option').forEach(option => {
            option.addEventListener('click', (e) => this.changeChatBackground(e.currentTarget.dataset.bg));
        });

        document.getElementById('backgroundImageInput').addEventListener('change', (e) => this.handleBackgroundImageUpload(e));

        document.getElementById('selectAllMessages').addEventListener('click', () => this.selectAllMessages());
        document.getElementById('deleteSelectedMessages').addEventListener('click', () => this.deleteSelectedMessages());
        document.getElementById('cancelSelection').addEventListener('click', () => this.exitSelectionMode());
        document.getElementById('toggleSelectionMode').addEventListener('click', () => this.enterSelectionMode());

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#userMenuBtn')) {
                document.getElementById('userDropdown').classList.add('hidden');
            }

            document.querySelectorAll('.message-menu').forEach(menu => {
                if (!e.target.closest('.message-menu') && !e.target.closest('.message-menu-btn')) {
                    menu.classList.add('hidden');
                }
            });
        });

        document.getElementById('toastClose').addEventListener('click', () => this.hideToast());

        document.addEventListener('click', (e) => {
            const closeAction = e.target.closest('[data-action="close-modal"]');
            if (closeAction) {
                const modalId = closeAction.dataset.modal;
                if (modalId === 'messageInfoModal') {
                    this.closeMessageInfoModal();
                } else if (modalId === 'imageViewerModal') {
                    this.closeImageViewer();
                }
            }
        });

        document.addEventListener('contextmenu', (e) => {
            const messageElement = e.target.closest('[data-message-id]');
            if (messageElement && !this.isSelectionMode) {
                e.preventDefault();
                this.showMessageContextMenu(e, messageElement.dataset.messageId);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isSelectionMode) {
                    this.exitSelectionMode();
                }
                if (!document.getElementById('profileModal').classList.contains('hidden')) {
                    this.closeProfileModal();
                }
                if (!document.getElementById('settingsModal').classList.contains('hidden')) {
                    this.closeSettingsModal();
                }
                if (!document.getElementById('messageInfoModal').classList.contains('hidden')) {
                    this.closeMessageInfoModal();
                }
                if (!document.getElementById('imageViewerModal').classList.contains('hidden')) {
                    this.closeImageViewer();
                }
            }
        });
    }

    setupMobileEventListeners() {
        document.getElementById('openSidebar').addEventListener('click', () => this.openMobileSidebar());
        document.getElementById('closeSidebar').addEventListener('click', () => this.closeMobileSidebar());
        document.getElementById('mobileOverlay').addEventListener('click', () => this.closeMobileSidebar());

        document.addEventListener('userSelected', () => {
            if (this.isMobile) {
                this.closeMobileSidebar();
            }
        });
    }

    openMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('mobileOverlay');

        sidebar.classList.add('open');
        overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('mobileOverlay');

        sidebar.classList.remove('open');
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
    }

    applyTheme() {
        const theme = this.settings.theme;
        const isDarkMode = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }

        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.innerHTML = isDarkMode
                ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>'
                : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>';
        }

        this.applyChatBackground();
    }

    applyChatBackground() {
        const messagesArea = document.getElementById('messagesArea');
        const welcomeScreen = document.getElementById('welcomeScreen');

        [messagesArea, welcomeScreen].forEach(element => {
            if (element) {
                element.className = element.className.replace(/chat-bg-\w+/g, '');
                element.style.backgroundImage = '';
            }
        });

        if (this.settings.chatBackground === 'custom' && this.settings.customBackground) {
            [messagesArea, welcomeScreen].forEach(element => {
                if (element) {
                    element.classList.add('chat-bg-custom');
                    element.style.backgroundImage = `url(${this.settings.customBackground})`;
                    element.style.backgroundSize = 'cover';
                    element.style.backgroundPosition = 'center';
                    element.style.backgroundRepeat = 'no-repeat';
                }
            });
        } else {
            [messagesArea, welcomeScreen].forEach(element => {
                if (element) {
                    element.classList.add(`chat-bg-${this.settings.chatBackground}`);
                }
            });
        }
    }

    toggleDarkMode() {
        const currentTheme = this.settings.theme;
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        this.changeTheme(newTheme);
    }

    changeTheme(theme) {
        this.settings.theme = theme;
        localStorage.setItem('theme', theme);
        this.applyTheme();

        const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
        if (radio) radio.checked = true;
    }

    changeChatBackground(background) {
        this.settings.chatBackground = background;
        localStorage.setItem('chatBackground', background);
        this.applyChatBackground();

        document.querySelectorAll('.chat-bg-option').forEach(option => {
            option.classList.remove('border-primary-500');
            option.classList.add('border-transparent');
        });

        const selectedOption = document.querySelector(`[data-bg="${background}"]`);
        if (selectedOption) {
            selectedOption.classList.remove('border-transparent');
            selectedOption.classList.add('border-primary-500');
        }
    }

    handleBackgroundImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            this.showToast('Dosya boyutu 5MB\'dan küçük olmalı', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = this.fixBase64Format(e.target.result);


            this.settings.customBackground = dataUrl;
            localStorage.setItem('customBackground', dataUrl);
            this.changeChatBackground('custom');
            this.showToast('Arka plan değiştirildi', 'success');
        };
        reader.readAsDataURL(file);
    }

    openProfileModal() {
        const modal = document.getElementById('profileModal');

        document.getElementById('profileFirstName').value = this.currentUser.firstName || '';
        document.getElementById('profileLastName').value = this.currentUser.lastName || '';
        document.getElementById('profileUsername').value = this.currentUser.username || '';
        document.getElementById('profileEmail').value = this.currentUser.email || '';

        this.updateProfileAvatarDisplay();

        modal.classList.remove('hidden');
        document.getElementById('userDropdown').classList.add('hidden');
    }

    updateProfileAvatarDisplay() {
        const profileAvatar = document.getElementById('profileAvatar');
        if (this.currentUser.avatar) {
            const fixedAvatar = this.fixBase64Format(this.currentUser.avatar);
            profileAvatar.style.backgroundImage = `url(${fixedAvatar})`;
            profileAvatar.style.backgroundSize = 'cover';
            profileAvatar.style.backgroundPosition = 'center';
            profileAvatar.textContent = '';
        } else {
            profileAvatar.style.backgroundImage = '';
            profileAvatar.textContent = (this.currentUser.firstName[0] + this.currentUser.lastName[0]).toUpperCase();
        }
    }

    closeProfileModal() {
        document.getElementById('profileModal').classList.add('hidden');
    }

    async handleProfileUpdate(e) {
        e.preventDefault();

        const firstName = document.getElementById('profileFirstName').value.trim();
        const lastName = document.getElementById('profileLastName').value.trim();
        const username = document.getElementById('profileUsername').value.trim();

        if (!firstName || !lastName || !username) {
            this.showToast('Tüm alanları doldurun', 'error');
            return;
        }

        this.setLoading('saveProfile', true);

        try {
            const updateData = {
                firstName,
                lastName,
                username
            };

            if (this.currentUser.avatar !== undefined) {
                updateData.avatar = this.currentUser.avatar;
            }

            const response = await this.apiCall('/api/user/profile', {
                method: 'PUT',
                body: JSON.stringify(updateData)
            });

            if (response.success) {
                this.currentUser = response.data.user;
                this.updateUserInfo();
                this.updateProfileAvatarDisplay();
                this.closeProfileModal();
                this.showToast('Profil güncellendi', 'success');
            } else {
                this.showToast(response.message || 'Profil güncellenirken hata oluştu', 'error');
            }
        } catch (error) {
            console.error('Profile update error:', error);
            this.showToast('Sunucu hatası', 'error');
        } finally {
            this.setLoading('saveProfile', false);
        }
    }

    async handleAvatarUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            this.showToast('Dosya boyutu 5MB\'dan küçük olmalı', 'error');
            return;
        }

        if (!file.type.startsWith('image/')) {
            this.showToast('Sadece resim dosyaları yüklenebilir', 'error');
            return;
        }

        this.showToast('Profil resmi yükleniyor...', 'info');

        try {
            const base64Data = await this.fileToBase64(file);
            this.currentUser.avatar = base64Data;

            this.updateProfileAvatarDisplay();

            const response = await this.apiCall('/api/user/profile', {
                method: 'PUT',
                body: JSON.stringify({
                    firstName: this.currentUser.firstName,
                    lastName: this.currentUser.lastName,
                    username: this.currentUser.username,
                    avatar: base64Data
                })
            });

            if (response.success) {
                this.currentUser = response.data.user;

                this.updateUserInfo();
                this.updateProfileAvatarDisplay();

                this.showToast('Profil resmi güncellendi', 'success');
            } else {
                console.error('Avatar update failed:', response.message);
                this.showToast(response.message || 'Profil resmi güncellenirken hata oluştu', 'error');
            }
        } catch (error) {
            console.error('Avatar upload error:', error);
            this.showToast('Profil resmi yüklenirken hata oluştu', 'error');
        }
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = this.fixBase64Format(reader.result);
                resolve(result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    openSettingsModal() {
        const modal = document.getElementById('settingsModal');

        const themeRadio = document.querySelector(`input[name="theme"][value="${this.settings.theme}"]`);
        if (themeRadio) themeRadio.checked = true;

        document.querySelectorAll('.chat-bg-option').forEach(option => {
            option.classList.remove('border-primary-500');
            option.classList.add('border-transparent');
        });

        const currentBg = this.settings.chatBackground === 'custom' ? 'default' : this.settings.chatBackground;
        const selectedOption = document.querySelector(`[data-bg="${currentBg}"]`);
        if (selectedOption) {
            selectedOption.classList.remove('border-transparent');
            selectedOption.classList.add('border-primary-500');
        }

        modal.classList.remove('hidden');
        document.getElementById('userDropdown').classList.add('hidden');
    }

    closeSettingsModal() {
        document.getElementById('settingsModal').classList.add('hidden');
    }

    hideLoading() {
        document.getElementById('loadingOverlay').classList.add('hidden');
    }

    showAuthIfNeeded() {
        if (!this.isAuthenticated) {
            document.getElementById('authContainer').classList.remove('hidden');
        }
    }

    switchAuthMode(mode) {
        const loginTab = document.getElementById('loginTab');
        const registerTab = document.getElementById('registerTab');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');

        if (mode === 'login') {
            loginTab.classList.add('bg-white', 'bg-opacity-30', 'border', 'border-white', 'border-opacity-20');
            registerTab.classList.remove('bg-white', 'bg-opacity-30', 'border', 'border-white', 'border-opacity-20');
            loginForm.classList.remove('hidden');
            registerForm.classList.add('hidden');
        } else {
            registerTab.classList.add('bg-white', 'bg-opacity-30', 'border', 'border-white', 'border-opacity-20');
            loginTab.classList.remove('bg-white', 'bg-opacity-30', 'border', 'border-white', 'border-opacity-20');
            registerForm.classList.remove('hidden');
            loginForm.classList.add('hidden');
        }

        this.hideError();
    }

    togglePasswordVisibility() {
        const passwordInputs = document.querySelectorAll('#loginPassword, #registerPassword');
        const toggleBtn = document.getElementById('togglePassword');
        const isPassword = document.getElementById('loginPassword').type === 'password';

        passwordInputs.forEach(input => {
            input.type = isPassword ? 'text' : 'password';
        });

        toggleBtn.innerHTML = isPassword ?
            '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"/></svg>' :
            '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
    }

    async handleLogin(e) {
        e.preventDefault();

        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        if (!email) {
            this.showError('E-posta adresi gerekli');
            return;
        }
        if (!password) {
            this.showError('Şifre gerekli');
            return;
        }
        if (password.length < 6) {
            this.showError('Şifre en az 6 karakter olmalı');
            return;
        }

        this.setLoading('loginBtn', true);
        this.hideError();

        try {
            const response = await fetch(`${this.apiUrl}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': this.sessionId
                },
                body: JSON.stringify({
                    email: email,
                    password: password
                })
            });

            const data = await response.json();

            if (data.success) {
                this.accessToken = data.data.tokens.accessToken;
                this.refreshToken = data.data.tokens.refreshToken;
                this.currentUser = data.data.user;

                localStorage.setItem('accessToken', this.accessToken);
                localStorage.setItem('refreshToken', this.refreshToken);

                this.isAuthenticated = true;
                await this.initializeApp();
                this.showToast('Başarıyla giriş yapıldı!', 'success');
            } else {
                if (data.errors && Array.isArray(data.errors)) {
                    const errorMessages = data.errors.map(err => err.msg || err.message).join(', ');
                    this.showError(`Doğrulama hatası: ${errorMessages}`);
                } else {
                    this.showError(data.message || 'Giriş yapılırken hata oluştu');
                }
            }
        } catch (error) {
            this.showError('Sunucu ile bağlantı kurulamadı: ' + error.message);
        } finally {
            this.setLoading('loginBtn', false);
        }
    }

    async handleRegister(e) {
        e.preventDefault();

        const firstName = document.getElementById('registerFirstName').value.trim();
        const lastName = document.getElementById('registerLastName').value.trim();
        const username = document.getElementById('registerUsername').value.trim();
        const email = document.getElementById('registerEmail').value.trim();
        const password = document.getElementById('registerPassword').value;

        if (!firstName) {
            this.showError('Ad gerekli');
            return;
        }
        if (!lastName) {
            this.showError('Soyad gerekli');
            return;
        }
        if (!username) {
            this.showError('Kullanıcı adı gerekli');
            return;
        }
        if (username.length < 3) {
            this.showError('Kullanıcı adı en az 3 karakter olmalı');
            return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            this.showError('Kullanıcı adı sadece harf, rakam ve alt çizgi içerebilir');
            return;
        }
        if (!email) {
            this.showError('E-posta adresi gerekli');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showError('Geçerli bir e-posta adresi girin');
            return;
        }
        if (!password) {
            this.showError('Şifre gerekli');
            return;
        }
        if (password.length < 6) {
            this.showError('Şifre en az 6 karakter olmalı');
            return;
        }

        const formData = {
            firstName: firstName,
            lastName: lastName,
            username: username,
            email: email,
            password: password
        };

        this.setLoading('registerBtn', true);
        this.hideError();

        try {
            const response = await fetch(`${this.apiUrl}/api/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': this.sessionId
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (data.success) {
                this.accessToken = data.data.tokens.accessToken;
                this.refreshToken = data.data.tokens.refreshToken;
                this.currentUser = data.data.user;

                localStorage.setItem('accessToken', this.accessToken);
                localStorage.setItem('refreshToken', this.refreshToken);

                this.isAuthenticated = true;
                await this.initializeApp();
                this.showToast('Hesap başarıyla oluşturuldu!', 'success');
            } else {
                if (data.errors && Array.isArray(data.errors)) {
                    const errorMessages = data.errors.map(err => {
                        if (err.param) {
                            const fieldNames = {
                                'firstName': 'Ad',
                                'lastName': 'Soyad',
                                'username': 'Kullanıcı adı',
                                'email': 'E-posta',
                                'password': 'Şifre'
                            };
                            return `${fieldNames[err.param] || err.param}: ${err.msg}`;
                        }
                        return err.msg || err.message;
                    }).join('\n');
                    this.showError(`Doğrulama hataları:\n${errorMessages}`);
                } else {
                    this.showError(data.message || 'Kayıt olurken hata oluştu');
                }
            }
        } catch (error) {
            this.showError('Sunucu ile bağlantı kurulamadı: ' + error.message);
        } finally {
            this.setLoading('registerBtn', false);
        }
    }

    async initializeApp() {
        document.getElementById('authContainer').classList.add('hidden');
        document.getElementById('chatContainer').classList.remove('hidden');

        this.updateUserInfo();
        await this.loadUsers();
        this.initializeSocket();
        await this.updateOnlineCount();
        this.applyChatBackground();
    }

    updateUserInfo() {
        const userName = document.getElementById('userName');
        const userAvatar = document.getElementById('userAvatar');

        userName.textContent = `${this.currentUser.firstName} ${this.currentUser.lastName}`;

        if (this.currentUser.avatar) {
            const fixedAvatar = this.fixBase64Format(this.currentUser.avatar);
            userAvatar.style.backgroundImage = `url(${fixedAvatar})`;
            userAvatar.style.backgroundSize = 'cover';
            userAvatar.style.backgroundPosition = 'center';
            userAvatar.textContent = '';
        } else {
            userAvatar.style.backgroundImage = '';
            userAvatar.textContent = (this.currentUser.firstName[0] + this.currentUser.lastName[0]).toUpperCase();
        }
    }

    async loadUsers() {
        try {
            const response = await this.apiCall('/api/user/list');
            if (response.success) {
                this.users = response.data.users;
                this.filteredUsers = [...this.users];
                this.renderUsers();
                document.getElementById('userCount').textContent = this.users.length;
            }
        } catch (error) {
            this.showToast('Kullanıcılar yüklenirken hata oluştu', 'error');
        }
    }

    renderUsers() {
        const usersList = document.getElementById('usersList');
        const noUsersMessage = document.getElementById('noUsersMessage');

        usersList.innerHTML = '';

        if (this.filteredUsers.length === 0) {
            noUsersMessage.classList.remove('hidden');
            return;
        } else {
            noUsersMessage.classList.add('hidden');
        }

        this.filteredUsers.forEach(user => {
            const userElement = this.createUserElement(user);
            usersList.appendChild(userElement);
        });
    }

    createUserElement(user) {
        const div = document.createElement('div');
        div.className = `p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-all duration-200 relative animate-fade-in ${
            this.selectedUser?._id === user._id ? 'bg-primary-50 dark:bg-primary-900 border border-primary-200 dark:border-primary-700' : ''
        }`;
        div.dataset.userId = user._id;

        const avatarContent = user.avatar
            ? `<div class="w-12 h-12 rounded-full bg-cover bg-center" style="background-image: url(${this.fixBase64Format(user.avatar)})"></div>`
            : `<div class="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full flex items-center justify-center font-medium text-white">${(user.firstName[0] + user.lastName[0]).toUpperCase()}</div>`;

        const lastSeenText = this.getLastSeenText(user);

        const unreadCount = user.unreadCount || 0;

        div.innerHTML = `
            <div class="flex items-center space-x-3">
                <div class="relative">
                    ${avatarContent}
                    <div class="absolute -bottom-1 -right-1 w-3 h-3 border-2 border-white dark:border-gray-800 rounded-full ${
            user.isOnline ? 'bg-success animate-pulse-soft' : 'bg-gray-400'
        }"></div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-gray-900 dark:text-gray-100 truncate">${user.firstName} ${user.lastName}</div>
                    <div class="text-sm text-gray-500 dark:text-gray-400 truncate">
                        ${user.isOnline ? 'Online' : lastSeenText}
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    ${unreadCount > 0 ? `
                        <div class="bg-primary-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-2 shadow-soft animate-pulse-soft">
                            ${unreadCount > 99 ? '99+' : unreadCount}
                        </div>
                    ` : ''}
                    <button class="delete-chat-btn hidden p-1 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900 dark:hover:bg-opacity-20 rounded-lg transition-colors" data-user-id="${user._id}" title="Sohbeti Sil">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        div.addEventListener('mouseenter', () => {
            const deleteBtn = div.querySelector('.delete-chat-btn');
            deleteBtn.classList.remove('hidden');
        });

        div.addEventListener('mouseleave', () => {
            const deleteBtn = div.querySelector('.delete-chat-btn');
            deleteBtn.classList.add('hidden');
        });

        const deleteBtn = div.querySelector('.delete-chat-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteChatWithUser(user);
        });

        div.addEventListener('click', (e) => {
            if (e.target.closest('.delete-chat-btn')) return;

            this.selectUser(user);
            document.dispatchEvent(new CustomEvent('userSelected'));
        });

        return div;
    }

    async deleteChatWithUser(user) {
        if (!confirm(`${user.firstName} ${user.lastName} ile olan sohbeti silmek istediğinizden emin misiniz?`)) {
            return;
        }

        try {
            const convResponse = await this.apiCall('/api/conversation/create', {
                method: 'POST',
                body: JSON.stringify({
                    participantId: user._id,
                    sessionId: this.sessionId
                })
            });

            if (!convResponse.success) {
                this.showToast('Sohbet bulunamadı', 'error');
                return;
            }

            const conversationId = convResponse.data.conversation._id;

            const deleteResponse = await this.apiCall(`/api/conversation/${conversationId}`, {
                method: 'DELETE'
            });

            if (deleteResponse.success) {
                this.showToast('Sohbet silindi', 'success');

                if (this.selectedUser && this.selectedUser._id === user._id) {
                    this.selectedUser = null;
                    this.currentConversation = null;
                    this.messages = [];
                    this.showWelcomeScreen();
                }

                user.unreadCount = 0;
                this.renderUsers();
            } else {
                this.showToast(deleteResponse.message || 'Sohbet silinirken hata oluştu', 'error');
            }
        } catch (error) {
            this.showToast('Sunucu hatası', 'error');
        }
    }

    showWelcomeScreen() {
        document.getElementById('chatHeader').classList.add('hidden');
        document.getElementById('messagesArea').classList.add('hidden');
        document.getElementById('messageInput').classList.add('hidden');
        document.getElementById('welcomeScreen').classList.remove('hidden');

        this.exitSelectionMode();
    }

    getLastSeenText(user) {
        if (user.isOnline) return 'Online';
        if (!user.lastSeen) return 'Hiç online olmadı';

        const lastSeen = new Date(user.lastSeen);
        const now = new Date();
        const diffInMs = now - lastSeen;
        const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
        const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
        const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

        if (diffInMinutes < 1) {
            return 'Az önce görüldü';
        } else if (diffInMinutes < 60) {
            return `${diffInMinutes} dakika önce görüldü`;
        } else if (diffInHours < 24) {
            return `${diffInHours} saat önce görüldü`;
        } else if (diffInDays < 7) {
            return `${diffInDays} gün önce görüldü`;
        } else {
            return lastSeen.toLocaleDateString('tr-TR');
        }
    }

    filterUsers() {
        const query = document.getElementById('userSearch').value.toLowerCase();

        if (!query.trim()) {
            this.filteredUsers = [...this.users];
        } else {
            this.filteredUsers = this.users.filter(user =>
                user.firstName.toLowerCase().includes(query) ||
                user.lastName.toLowerCase().includes(query) ||
                user.username.toLowerCase().includes(query)
            );
        }

        this.renderUsers();
    }

    async selectUser(user) {
        this.selectedUser = user;
        this.renderUsers();
        this.updateChatHeader();
        this.showChatArea();

        try {
            const response = await this.apiCall('/api/conversation/create', {
                method: 'POST',
                body: JSON.stringify({
                    participantId: user._id,
                    sessionId: this.sessionId
                })
            });

            if (response.success) {
                this.currentConversation = response.data.conversation;
                this.currentConversation.sessionId = this.generateUUID();

                if (this.socket) {
                    this.socket.emit('join_room', {
                        conversationId: this.currentConversation._id,
                        sessionId: this.currentConversation.sessionId
                    });
                }

                await this.loadMessages();
            }
        } catch (error) {
            this.showToast('Konuşma başlatılırken hata oluştu', 'error');
        }
    }

    updateChatHeader() {
        if (!this.selectedUser) return;

        const chatHeader = document.getElementById('chatHeader');
        const chatUserName = document.getElementById('chatUserName');
        const chatUserAvatar = document.getElementById('chatUserAvatar');
        const chatUserStatus = document.getElementById('chatUserStatus');
        const chatStatusIcon = document.getElementById('chatStatusIcon');
        const chatStatusText = document.getElementById('chatStatusText');

        chatUserName.textContent = `${this.selectedUser.firstName} ${this.selectedUser.lastName}`;

        if (this.selectedUser.avatar) {
            const fixedAvatar = this.fixBase64Format(this.selectedUser.avatar);
            chatUserAvatar.style.backgroundImage = `url(${fixedAvatar})`;
            chatUserAvatar.style.backgroundSize = 'cover';
            chatUserAvatar.style.backgroundPosition = 'center';
            chatUserAvatar.textContent = '';
        } else {
            chatUserAvatar.style.backgroundImage = '';
            chatUserAvatar.textContent = (this.selectedUser.firstName[0] + this.selectedUser.lastName[0]).toUpperCase();
        }

        const lastSeenText = this.getLastSeenText(this.selectedUser);

        if (this.selectedUser.isOnline) {
            chatUserStatus.className = 'absolute -bottom-1 -right-1 w-3 h-3 border-2 border-white dark:border-gray-800 rounded-full bg-success animate-pulse-soft';
            chatStatusIcon.className = 'w-2 h-2 rounded-full mr-2 bg-success animate-pulse-soft';
            chatStatusText.textContent = 'Online';
        } else {
            chatUserStatus.className = 'absolute -bottom-1 -right-1 w-3 h-3 border-2 border-white dark:border-gray-800 rounded-full bg-gray-400';
            chatStatusIcon.className = 'w-2 h-2 rounded-full mr-2 bg-gray-400';
            chatStatusText.textContent = lastSeenText;
        }

        chatHeader.classList.remove('hidden');
    }

    showChatArea() {
        document.getElementById('welcomeScreen').classList.add('hidden');
        document.getElementById('messagesArea').classList.remove('hidden');
        document.getElementById('messageInput').classList.remove('hidden');
    }

    showMessagesLoading() {
        document.getElementById('messagesLoading').classList.remove('hidden');
    }

    hideMessagesLoading() {
        document.getElementById('messagesLoading').classList.add('hidden');
    }

    async loadMessages() {
        if (!this.currentConversation) return;

        this.showMessagesLoading();

        try {
            const response = await this.apiCall(`/api/message/conversation/${this.currentConversation._id}`);
            if (response.success) {
                this.messages = response.data.messages;
                this.renderMessages();

                if (this.messages.length > 0) {
                    const unreadMessageIds = this.messages
                        .filter(msg => msg.sender._id !== this.currentUser.id && !this.isMessageReadByUser(msg))
                        .map(msg => msg._id);

                    if (unreadMessageIds.length > 0) {
                        await this.markMessagesAsRead(unreadMessageIds);
                    }
                }
            }
        } catch (error) {
            this.showToast('Mesajlar yüklenirken hata oluştu', 'error');
        } finally {
            this.hideMessagesLoading();
        }
    }

    isMessageReadByUser(message) {
        return message.readBy && message.readBy.some(read => read.user === this.currentUser._id);
    }

    async markMessagesAsRead(messageIds) {
        try {
            await this.apiCall('/api/message/read', {
                method: 'PUT',
                body: JSON.stringify({ messageIds })
            });

            if (this.socket && this.currentConversation) {
                this.socket.emit('mark_messages_read', {
                    messageIds,
                    conversationId: this.currentConversation._id,
                    sessionId: this.currentConversation.sessionId
                });
            }
        } catch (error) {
        }
    }

    renderMessages() {
        const messagesList = document.getElementById('messagesList');
        const noMessagesMessage = document.getElementById('noMessagesMessage');

        messagesList.innerHTML = '';

        if (this.messages.length === 0) {
            noMessagesMessage.classList.remove('hidden');
            return;
        } else {
            noMessagesMessage.classList.add('hidden');
        }

        this.messages.forEach(message => {
            const messageElement = this.createMessageElement(message);
            messagesList.appendChild(messageElement);
        });

        this.scrollToBottom();
    }

    addNewMessage(message) {
        const messagesList = document.getElementById('messagesList');
        const noMessagesMessage = document.getElementById('noMessagesMessage');

        if (!noMessagesMessage.classList.contains('hidden')) {
            noMessagesMessage.classList.add('hidden');
        }

        const messageElement = this.createMessageElement(message);
        messageElement.classList.add('animate-slide-up');
        messagesList.appendChild(messageElement);

        this.messages.push(message);

        this.scrollToBottom();
    }

    updatePendingMessage(messageId, updatedMessage) {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.classList.remove('opacity-75');

            const messageIndex = this.messages.findIndex(m =>
                m.messageId === messageId || m._id === messageId
            );

            if (messageIndex !== -1) {
                this.messages[messageIndex] = updatedMessage;

                const newMessageElement = this.createMessageElement(updatedMessage);
                messageElement.replaceWith(newMessageElement);
            }
        }
    }

    createMessageElement(message) {
        const div = document.createElement('div');
        const isOwn = message.sender._id === this.currentUser.id;
        const isSelected = this.selectedMessages.has(message._id);

        div.className = `flex ${isOwn ? 'justify-end' : 'justify-start'} animate-slide-up ${isSelected ? 'bg-blue-50 dark:bg-blue-900 bg-opacity-50' : ''}`;
        div.dataset.messageId = message._id;

        const deliveryStatus = this.getMessageDeliveryStatus(message);
        const statusIcon = this.getDeliveryStatusIcon(deliveryStatus, isOwn);

        let messageContent = '';
        if (message.type === 'file' || message.type === 'image' || message.type === 'video' || message.type === 'audio') {
            if (message.fileData) {
                if (message.type === 'image') {
                    const imageSrc = this.fixBase64Format(message.fileData.data);
                    const imageName = this.escapeHtml(message.fileData.name || 'Image');

                    messageContent = `
                        <div class="mb-3 relative group">
                            <img src="${imageSrc}" 
                                 alt="${imageName}" 
                                 class="max-w-full h-auto rounded-xl shadow-soft cursor-pointer hover:opacity-90 transition-opacity" 
                                 style="max-height: 300px; max-width: 250px;"
                                 data-action="view-image"
                                 data-image-src="${imageSrc}"
                                 data-image-name="${imageName}"
                                 loading="lazy"
                                 onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=\\'text-red-500 text-sm\\'>Resim yüklenemedi</div>'">
                            <div class="absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                <button class="hover:text-blue-300 mr-1" data-action="download-file" data-message-id="${message._id}" title="Dosyayı İndir">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <p class="text-sm">${imageName}</p>
                    `;
                } else if (message.type === 'video') {
                    const videoSrc = this.fixBase64Format(message.fileData.data);
                    const videoName = this.escapeHtml(message.fileData.name || 'Video');

                    messageContent = `
                        <div class="mb-3 relative group">
                            <video 
                                class="max-w-full h-auto rounded-xl shadow-soft" 
                                style="max-height: 300px; max-width: 250px;"
                                controls
                                preload="metadata"
                                onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=\\'text-red-500 text-sm\\'>Video yüklenemedi</div>'">
                                <source src="${videoSrc}" type="${message.fileData.type}">
                                Tarayıcınız video oynatmayı desteklemiyor.
                            </video>
                            <div class="absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                <button class="hover:text-blue-300 mr-1" data-action="download-file" data-message-id="${message._id}" title="Videoyu İndir">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <p class="text-sm">${videoName}</p>
                    `;
                } else if (message.type === 'audio') {
                    const audioSrc = this.fixBase64Format(message.fileData.data);
                    const audioName = this.escapeHtml(message.fileData.name || 'Audio');

                    messageContent = `
                        <div class="mb-3 relative group">
                            <div class="bg-black bg-opacity-10 rounded-xl p-3">
                                <audio 
                                    class="w-full max-w-[200px]"
                                    controls
                                    preload="metadata"
                                    onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=\\'text-red-500 text-sm\\'>Ses dosyası yüklenemedi</div>'">
                                    <source src="${audioSrc}" type="${message.fileData.type}">
                                    Tarayıcınız ses oynatmayı desteklemiyor.
                                </audio>
                            </div>
                            <div class="absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                <button class="hover:text-blue-300 mr-1" data-action="download-file" data-message-id="${message._id}" title="Ses Dosyasını İndir">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <p class="text-sm">${audioName}</p>
                    `;
                } else {
                    const fileName = this.escapeHtml(message.fileData.name || 'File');
                    const fileSize = this.formatFileSize(message.fileData.size);
                    const fileIcon = this.getFileIcon(message.fileData.type);

                    messageContent = `
                        <div class="flex items-center space-x-3 p-3 bg-black bg-opacity-10 rounded-xl cursor-pointer hover:bg-opacity-20 transition-colors group" data-action="download-file" data-message-id="${message._id}" title="Dosyayı İndir">
                            <div class="w-10 h-10 bg-white bg-opacity-20 rounded-xl flex items-center justify-center">
                                ${fileIcon}
                            </div>
                            <div class="flex-1">
                                <p class="text-sm font-medium truncate max-w-[150px]">${fileName}</p>
                                <p class="text-xs opacity-75">${fileSize}</p>
                            </div>
                            <div class="text-white bg-opacity-60 opacity-0 group-hover:opacity-100 transition-opacity">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                                    </svg>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else {
                messageContent = `<p class="text-sm">${this.escapeHtml(message.content)}</p>`;
            }
        } else if (message.isDeleted) {
            messageContent = `<p class="text-sm italic opacity-60">Bu mesaj silindi</p>`;
        } else {
            messageContent = `<p class="break-words">${this.escapeHtml(message.content)}</p>`;
        }

        const timeText = this.formatTime(message.createdAt);
        const deliveryInfo = this.getDeliveryInfo(message);

        const pendingClass = message.isPending ? 'opacity-75' : '';

        div.innerHTML = `
            <div class="max-w-xs md:max-w-md lg:max-w-lg group relative ${pendingClass}">
                ${this.isSelectionMode ? `
                    <div class="absolute -left-8 top-1/2 transform -translate-y-1/2">
                        <input type="checkbox" class="message-checkbox w-4 h-4 text-blue-600 rounded" 
                               ${isSelected ? 'checked' : ''} 
                               data-action="toggle-selection" data-message-id="${message._id}">
                    </div>
                ` : ''}
                <div class="px-5 py-4 ${
            isOwn
                ? 'message-sent text-white'
                : 'message-received text-gray-900 dark:text-gray-100'
        } shadow-soft relative">
                    ${!this.isSelectionMode ? `
                        <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button class="message-menu-btn p-1 hover:bg-white hover:bg-opacity-20 hover:bg-gray-200 dark:hover:bg-gray-600 rounded" data-action="toggle-menu" data-message-id="${message._id}">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"/>
                                </svg>
                            </button>
                            <div id="messageMenu-${message._id}" class="message-menu hidden absolute top-8 right-0 bg-white dark:bg-gray-800 rounded-lg shadow-lg py-2 min-w-[150px] z-50">
                                <button class="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm" data-action="show-info" data-message-id="${message._id}">
                                    Mesaj Bilgisi
                                </button>
                                <button class="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm" data-action="delete-for-me" data-message-id="${message._id}">
                                    Benim İçin Sil
                                </button>
                                ${this.canDeleteForEveryone(message) ? `
                                    <button class="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-red-600" data-action="delete-for-everyone" data-message-id="${message._id}">
                                        Herkesten Sil
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    ` : ''}
                    ${messageContent}
                    <div class="flex items-center justify-between mt-3">
                        <p class="text-xs ${isOwn ? 'text-white text-opacity-70' : 'text-gray-500 dark:text-gray-400'}" 
                           title="${deliveryInfo}">
                            ${timeText}
                        </p>
                        ${statusIcon}
                    </div>
                </div>
            </div>
        `;

        this.setupMessageEventListeners(div, message);

        return div;
    }

    getFileIcon(fileType) {
        if (!fileType) {
            return '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';
        }

        if (fileType.includes('pdf')) {
            return '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';
        } else if (fileType.includes('video')) {
            return '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293H15M9 10V9a2 2 0 012-2h2a2 2 0 012 2v1M9 10v5a2 2 0 002 2h2a2 2 0 002-2v-5"/></svg>';
        } else if (fileType.includes('audio')) {
            return '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>';
        } else if (fileType.includes('word') || fileType.includes('doc')) {
            return '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';
        } else if (fileType.includes('excel') || fileType.includes('sheet')) {
            return '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0V4a2 2 0 012-2h14a2 2 0 012 2v16a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
        } else if (fileType.includes('archive') || fileType.includes('zip') || fileType.includes('rar')) {
            return '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>';
        }

        return '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';
    }

    setupMessageEventListeners(messageElement, message) {
        messageElement.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            const messageId = e.target.closest('[data-message-id]')?.dataset.messageId;

            switch (action) {
                case 'view-image':
                    const imageSrc = e.target.dataset.imageSrc;
                    const imageName = e.target.dataset.imageName;
                    this.openImageViewer(imageSrc, imageName);
                    break;

                case 'download-file':
                    this.downloadFile(messageId);
                    break;

                case 'toggle-selection':
                    this.toggleMessageSelection(messageId);
                    break;

                case 'toggle-menu':
                    this.toggleMessageMenu(messageId);
                    break;

                case 'show-info':
                    this.showMessageInfo(messageId);
                    break;

                case 'delete-for-me':
                    this.deleteMessageForMe(messageId);
                    break;

                case 'delete-for-everyone':
                    this.deleteMessageForEveryone(messageId);
                    break;

                default:
                    if (this.isSelectionMode && !e.target.closest('.message-checkbox') && !e.target.closest('[data-action]')) {
                        this.toggleMessageSelection(message._id);
                    }
                    break;
            }
        });
    }

    showMessageContextMenu(event, messageId) {
        document.querySelectorAll('.message-context-menu').forEach(menu => {
            menu.remove();
        });

        const message = this.messages.find(m => m._id === messageId);
        if (!message) return;

        const isOwn = message.sender._id === this.currentUser.id;
        const canDeleteForEveryone = this.canDeleteForEveryone(message);

        const contextMenu = document.createElement('div');
        contextMenu.className = 'message-context-menu fixed bg-white dark:bg-gray-800 rounded-lg shadow-lg py-2 min-w-[150px] z-50';
        contextMenu.style.left = event.pageX + 'px';
        contextMenu.style.top = event.pageY + 'px';

        contextMenu.innerHTML = `
            <button class="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm" data-action="show-info" data-message-id="${messageId}">
                Mesaj Bilgisi
            </button>
            <button class="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm" data-action="delete-for-me" data-message-id="${messageId}">
                Benim İçin Sil
            </button>
            ${canDeleteForEveryone ? `
                <button class="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-red-600" data-action="delete-for-everyone" data-message-id="${messageId}">
                    Herkesten Sil
                </button>
            ` : ''}
        `;

        document.body.appendChild(contextMenu);

        const closeMenu = (e) => {
            if (!contextMenu.contains(e.target)) {
                contextMenu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);

        contextMenu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const messageId = e.target.dataset.messageId;

            if (action) {
                switch (action) {
                    case 'show-info':
                        this.showMessageInfo(messageId);
                        break;
                    case 'delete-for-me':
                        this.deleteMessageForMe(messageId);
                        break;
                    case 'delete-for-everyone':
                        this.deleteMessageForEveryone(messageId);
                        break;
                }
                contextMenu.remove();
            }
        });
    }

    getMessageDeliveryStatus(message) {
        if (!message.metadata) return 'sent';

        const isRead = this.isMessageReadByOthers(message);
        if (isRead) return 'read';

        return message.metadata.deliveryStatus || 'sent';
    }

    isMessageReadByOthers(message) {
        if (!message.readBy) return false;
        return message.readBy.some(read => read.user !== this.currentUser.id);
    }

    getDeliveryStatusIcon(status, isOwn) {
        if (!isOwn) return '';

        switch (status) {
            case 'sent':
                return `<div class="text-white text-opacity-70"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>`;
            case 'delivered':
                return `<div class="text-white text-opacity-70"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7M5 13l4 4L19 7"/></svg></div>`;
            case 'read':
                return `<div class="text-success text-opacity-90"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7M5 13l4 4L19 7"/></svg></div>`;
            default:
                return '';
        }
    }

    getDeliveryInfo(message) {
        if (!message.metadata) return this.formatTime(message.createdAt);

        let info = `Gönderildi: ${this.formatTime(message.metadata.sentAt || message.createdAt)}`;

        if (message.metadata.deliveredAt) {
            info += `\nTeslim edildi: ${this.formatTime(message.metadata.deliveredAt)}`;
        }

        if (message.metadata.readAt) {
            info += `\nOkundu: ${this.formatTime(message.metadata.readAt)}`;
        }

        return info;
    }

    canDeleteForEveryone(message) {
        if (message.sender._id !== this.currentUser.id) return false;

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const messageTime = new Date(message.createdAt);

        return messageTime > oneHourAgo;
    }

    toggleMessageMenu(messageId) {
        document.querySelectorAll('.message-menu').forEach(menu => {
            if (menu.id !== `messageMenu-${messageId}`) {
                menu.classList.add('hidden');
            }
        });

        const menu = document.getElementById(`messageMenu-${messageId}`);
        menu.classList.toggle('hidden');
    }

    async showMessageInfo(messageId) {
        try {
            const response = await this.apiCall(`/api/message/${messageId}/details`);
            if (response.success) {
                const message = response.data.message;
                this.openMessageInfoModal(message);
            }
        } catch (error) {
            this.showToast('Mesaj bilgileri yüklenirken hata oluştu', 'error');
        }
    }

    openMessageInfoModal(message) {
        const modal = document.getElementById('messageInfoModal');
        const content = document.getElementById('messageInfoContent');

        const sentTime = this.formatFullTime(message.metadata.sentAt || message.createdAt);
        const deliveredTime = message.metadata.deliveredAt ? this.formatFullTime(message.metadata.deliveredAt) : 'Henüz teslim edilmedi';
        const readTime = message.metadata.readAt ? this.formatFullTime(message.metadata.readAt) : 'Henüz okunmadı';

        content.innerHTML = `
            <div class="space-y-4">
                <div>
                    <h4 class="font-medium text-gray-900 dark:text-gray-100">Mesaj İçeriği</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400 mt-1 break-words">${this.escapeHtml(message.content)}</p>
                </div>
                <div>
                    <h4 class="font-medium text-gray-900 dark:text-gray-100">Durum Bilgileri</h4>
                    <div class="space-y-2 mt-2">
                        <div class="flex justify-between">
                            <span class="text-sm text-gray-600 dark:text-gray-400">Gönderildi:</span>
                            <span class="text-sm text-gray-900 dark:text-gray-100">${sentTime}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-sm text-gray-600 dark:text-gray-400">Teslim edildi:</span>
                            <span class="text-sm text-gray-900 dark:text-gray-100">${deliveredTime}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-sm text-gray-600 dark:text-gray-400">Okundu:</span>
                            <span class="text-sm text-gray-900 dark:text-gray-100">${readTime}</span>
                        </div>
                    </div>
                </div>
                ${message.readBy && message.readBy.length > 0 ? `
                    <div>
                        <h4 class="font-medium text-gray-900 dark:text-gray-100">Okuyan Kişiler</h4>
                        <div class="space-y-1 mt-2">
                            ${message.readBy.map(read => `
                                <div class="flex justify-between">
                                    <span class="text-sm text-gray-600 dark:text-gray-400">${read.user.firstName} ${read.user.lastName}</span>
                                    <span class="text-sm text-gray-900 dark:text-gray-100">${this.formatFullTime(read.readAt)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                ${message.fileData ? `
                    <div>
                        <h4 class="font-medium text-gray-900 dark:text-gray-100">Dosya Bilgileri</h4>
                        <div class="space-y-1 mt-2">
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600 dark:text-gray-400">Dosya Adı:</span>
                                <span class="text-sm text-gray-900 dark:text-gray-100">${message.fileData.name}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600 dark:text-gray-400">Dosya Boyutu:</span>
                                <span class="text-sm text-gray-900 dark:text-gray-100">${this.formatFileSize(message.fileData.size)}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600 dark:text-gray-400">Dosya Türü:</span>
                                <span class="text-sm text-gray-900 dark:text-gray-100">${message.fileData.type}</span>
                            </div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        modal.classList.remove('hidden');
    }

    closeMessageInfoModal() {
        document.getElementById('messageInfoModal').classList.add('hidden');
    }

    async deleteMessageForMe(messageId) {
        if (!confirm('Bu mesajı sadece sizin için silmek istediğinizden emin misiniz?')) {
            return;
        }

        try {
            const response = await this.apiCall(`/api/message/${messageId}/for-me`, {
                method: 'DELETE'
            });

            if (response.success) {
                const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
                if (messageElement) {
                    messageElement.remove();
                }

                this.messages = this.messages.filter(msg => msg._id !== messageId);

                this.showToast('Mesaj sizin için silindi', 'success');
            } else {
                this.showToast(response.message || 'Mesaj silinirken hata oluştu', 'error');
            }
        } catch (error) {
            this.showToast('Sunucu hatası', 'error');
        }
    }

    async deleteMessageForEveryone(messageId) {
        if (!confirm('Bu mesajı herkes için silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.')) {
            return;
        }

        try {
            if (this.socket && this.currentConversation) {
                this.socket.emit('delete_message', {
                    messageId: messageId,
                    deleteType: 'forEveryone',
                    conversationId: this.currentConversation._id
                });
            }

            this.showToast('Mesaj herkes için silindi', 'success');
        } catch (error) {
            this.showToast('Sunucu hatası', 'error');
        }
    }

    enterSelectionMode() {
        this.isSelectionMode = true;
        this.selectedMessages.clear();

        document.getElementById('selectionControls').classList.remove('hidden');

        this.renderMessages();
    }

    exitSelectionMode() {
        this.isSelectionMode = false;
        this.selectedMessages.clear();

        document.getElementById('selectionControls').classList.add('hidden');

        this.renderMessages();
    }

    toggleMessageSelection(messageId) {
        if (this.selectedMessages.has(messageId)) {
            this.selectedMessages.delete(messageId);
        } else {
            this.selectedMessages.add(messageId);
        }

        const checkbox = document.querySelector(`[data-message-id="${messageId}"] .message-checkbox`);
        if (checkbox) {
            checkbox.checked = this.selectedMessages.has(messageId);
        }

        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            if (this.selectedMessages.has(messageId)) {
                messageElement.classList.add('bg-blue-50', 'dark:bg-blue-900', 'bg-opacity-50');
            } else {
                messageElement.classList.remove('bg-blue-50', 'dark:bg-blue-900', 'bg-opacity-50');
            }
        }

        this.updateSelectionControls();
    }

    selectAllMessages() {
        this.messages.forEach(message => {
            this.selectedMessages.add(message._id);
        });
        this.renderMessages();
        this.updateSelectionControls();
    }

    updateSelectionControls() {
        const count = this.selectedMessages.size;
        const deleteBtn = document.getElementById('deleteSelectedMessages');
        const selectedCountEl = document.getElementById('selectedCount');

        if (selectedCountEl) {
            selectedCountEl.textContent = `${count} mesaj seçili`;
        }

        if (count > 0) {
            deleteBtn.textContent = `Seçilenleri Sil (${count})`;
            deleteBtn.disabled = false;
            deleteBtn.classList.remove('opacity-50');
        } else {
            deleteBtn.textContent = 'Seçilenleri Sil';
            deleteBtn.disabled = true;
            deleteBtn.classList.add('opacity-50');
        }
    }

    async deleteSelectedMessages() {
        if (this.selectedMessages.size === 0) return;

        if (!confirm(`${this.selectedMessages.size} mesajı silmek istediğinizden emin misiniz?`)) {
            return;
        }

        const messageIds = Array.from(this.selectedMessages);

        try {
            if (this.socket && this.currentConversation) {
                this.socket.emit('delete_multiple_messages', {
                    messageIds: messageIds,
                    conversationId: this.currentConversation._id
                });
            }

            this.showToast(`${messageIds.length} mesaj silindi`, 'success');
            this.exitSelectionMode();
        } catch (error) {
            this.showToast('Sunucu hatası', 'error');
        }
    }

    openImageViewer(imageSrc, imageName) {
        const modal = document.getElementById('imageViewerModal');
        const image = document.getElementById('viewerImage');
        const title = document.getElementById('viewerImageTitle');

        image.src = imageSrc;
        image.alt = imageName || 'Image';
        title.textContent = imageName || 'Image';

        modal.classList.remove('hidden');

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                this.closeImageViewer();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        document.body.style.overflow = 'hidden';
    }

    closeImageViewer() {
        const modal = document.getElementById('imageViewerModal');
        modal.classList.add('hidden');

        document.body.style.overflow = '';

        const image = document.getElementById('viewerImage');
        image.src = '';
    }

    async downloadFile(messageId) {
        try {
            this.showToast('Dosya indiriliyor...', 'info');

            const response = await fetch(`${this.apiUrl}/api/message/file/${messageId}`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'X-Session-ID': this.sessionId
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    this.showToast('Dosya bulunamadı', 'error');
                } else if (response.status === 403) {
                    this.showToast('Bu dosyaya erişim izniniz yok', 'error');
                } else {
                    this.showToast('Dosya indirilemedi', 'error');
                }
                return;
            }

            const blob = await response.blob();
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'download';

            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (filenameMatch && filenameMatch[1]) {
                    filename = filenameMatch[1].replace(/['"]/g, '');
                }
            }

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;

            document.body.appendChild(a);
            a.click();

            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            this.showToast('Dosya başarıyla indirildi', 'success');

        } catch (error) {
            console.error('Download error:', error);
            this.showToast('Dosya indirirken hata oluştu', 'error');
        }
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatFullTime(dateString) {
        return new Date(dateString).toLocaleString('tr-TR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        const maxSize = file.type.startsWith('video/') ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
        if (file.size > maxSize) {
            const limit = file.type.startsWith('video/') ? '25MB' : '10MB';
            this.showToast(`Dosya boyutu ${limit}\'dan küçük olmalı`, 'error');
            e.target.value = '';
            return;
        }

        const allowedTypes = [
            // Images
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
            // Videos
            'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm', 'video/mkv', 'video/3gp',
            // Documents
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain', 'text/csv',
            // Archives
            'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
            // Audio
            'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/m4a'
        ];

        if (!allowedTypes.includes(file.type)) {
            this.showToast(`Desteklenmeyen dosya türü: ${file.type}`, 'error');
            e.target.value = '';
            return;
        }


        this.selectedFile = file;
        this.showFilePreview(file);

        this.showToast('Dosya seçildi', 'success');
    }

    showFilePreview(file) {
        const filePreview = document.getElementById('filePreview');
        const fileName = document.getElementById('fileName');
        const fileSize = document.getElementById('fileSize');
        const fileIcon = document.getElementById('fileIcon');

        fileName.textContent = file.name;
        fileSize.textContent = this.formatFileSize(file.size);

        fileIcon.style.backgroundImage = '';
        fileIcon.innerHTML = '';

        if (file.type.startsWith('image/')) {
            fileIcon.innerHTML = `
                <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
            `;
            if (file.size < 5 * 1024 * 1024) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const result = this.fixBase64Format(e.target.result);

                    fileIcon.style.backgroundImage = `url(${result})`;
                    fileIcon.style.backgroundSize = 'cover';
                    fileIcon.style.backgroundPosition = 'center';
                    fileIcon.style.borderRadius = '0.75rem';
                    fileIcon.innerHTML = '';
                };
                reader.readAsDataURL(file);
            }
        } else if (file.type.startsWith('video/')) {
            fileIcon.innerHTML = `
                <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
            `;
            try {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    video.currentTime = 1;
                };
                video.onseeked = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 100;
                    canvas.height = 100;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, 100, 100);
                    const thumbnail = this.fixBase64Format(canvas.toDataURL());

                    fileIcon.style.backgroundImage = `url(${thumbnail})`;
                    fileIcon.style.backgroundSize = 'cover';
                    fileIcon.style.backgroundPosition = 'center';
                    fileIcon.style.borderRadius = '0.75rem';
                    fileIcon.innerHTML = `
                        <div class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-xl">
                            <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </div>
                    `;
                };
                video.src = URL.createObjectURL(file);
            } catch (error) {

            }
        } else if (file.type.startsWith('audio/')) {
            fileIcon.innerHTML = `
                <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                </svg>
            `;
        } else {
            fileIcon.innerHTML = this.getFileIcon(file.type);
        }

        filePreview.classList.remove('hidden');
    }

    removeSelectedFile() {
        this.selectedFile = null;
        document.getElementById('filePreview').classList.add('hidden');
        document.getElementById('fileInput').value = '';

        const fileIcon = document.getElementById('fileIcon');
        fileIcon.style.backgroundImage = '';
        fileIcon.innerHTML = `
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
        `;
    }

    async handleSendMessage(e) {
        e.preventDefault();

        const messageText = document.getElementById('messageText');
        const content = messageText.value.trim();

        if (!content && !this.selectedFile) {
            this.showToast('Mesaj içeriği veya dosya gerekli', 'error');
            return;
        }

        if (!this.currentConversation) {
            this.showToast('Sohbet seçilmedi', 'error');
            return;
        }

        if (!this.socket || !this.socket.connected) {
            this.showToast('Bağlantı sorunu. Yeniden bağlanıyor...', 'error');
            this.initializeSocket();
            return;
        }

        const messageId = this.generateUUID();

        if (this.pendingMessages.has(messageId)) {
            return;
        }

        this.pendingMessages.set(messageId, true);

        try {
            let messageData = {
                conversationId: this.currentConversation._id,
                content: content || (this.selectedFile ? this.selectedFile.name : ''),
                type: 'text',
                messageId: messageId,
                sessionId: this.currentConversation.sessionId
            };

            if (this.selectedFile) {
                try {
                    this.showToast('Dosya yükleniyor...', 'info');

                    const maxSize = this.selectedFile.type.startsWith('video/') ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
                    if (this.selectedFile.size > maxSize) {
                        const limit = this.selectedFile.type.startsWith('video/') ? '25MB' : '10MB';
                        this.showToast(`Dosya boyutu ${limit}'dan küçük olmalı`, 'error');
                        this.pendingMessages.delete(messageId);
                        return;
                    }

                    const fileData = await this.processFile(this.selectedFile);

                    if (this.selectedFile.type.startsWith('image/')) {
                        messageData.type = 'image';
                    } else if (this.selectedFile.type.startsWith('video/')) {
                        messageData.type = 'video';
                    } else if (this.selectedFile.type.startsWith('audio/')) {
                        messageData.type = 'audio';
                    } else {
                        messageData.type = 'file';
                    }

                    messageData.fileData = fileData;
                    messageData.content = content || this.selectedFile.name; // Use text content if provided, otherwise filename


                } catch (error) {
                    console.error('File processing error:', error);
                    this.showToast('Dosya işlenirken hata oluştu: ' + error.message, 'error');
                    this.pendingMessages.delete(messageId);
                    return;
                }
            }

            if (!this.socket || !this.socket.connected) {
                this.showToast('Bağlantı kesildi. Lütfen tekrar deneyin.', 'error');
                this.pendingMessages.delete(messageId);
                return;
            }

            const tempMessage = {
                _id: messageId,
                messageId: messageId,
                sender: {
                    _id: this.currentUser.id,
                    firstName: this.currentUser.firstName,
                    lastName: this.currentUser.lastName,
                    avatar: this.currentUser.avatar
                },
                content: messageData.content,
                type: messageData.type,
                fileData: messageData.fileData,
                createdAt: new Date(),
                metadata: {
                    deliveryStatus: 'sending',
                    sentAt: new Date()
                },
                isPending: true
            };

            this.addNewMessage(tempMessage);


            const sendPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Message send timeout'));
                }, 30000); // 30 saniye timeout

                const onMessageSent = (data) => {
                    if (data.messageId === messageId) {
                        clearTimeout(timeout);
                        this.socket.off('message_sent', onMessageSent);
                        this.socket.off('error', onError);
                        resolve(data);
                    }
                };

                const onError = (error) => {
                    clearTimeout(timeout);
                    this.socket.off('message_sent', onMessageSent);
                    this.socket.off('error', onError);
                    reject(new Error(error.message || 'Socket error'));
                };

                this.socket.on('message_sent', onMessageSent);
                this.socket.on('error', onError);

                this.socket.emit('send_message', messageData);
            });

            try {
                await sendPromise;

                messageText.value = '';
                this.removeSelectedFile();
                this.stopTyping();
                this.showToast('Mesaj gönderildi', 'success');

            } catch (sendError) {
                console.error('Message send failed:', sendError);

                const failedMessageElement = document.querySelector(`[data-message-id="${messageId}"]`);
                if (failedMessageElement) {
                    failedMessageElement.remove();
                }

                this.messages = this.messages.filter(msg => msg._id !== messageId);

                this.showToast('Mesaj gönderilemedi: ' + sendError.message, 'error');
            }

            setTimeout(() => {
                this.pendingMessages.delete(messageId);
            }, 60000);

        } catch (error) {
            console.error('Send message error:', error);
            this.showToast('Mesaj gönderilirken hata oluştu: ' + error.message, 'error');
            this.pendingMessages.delete(messageId);
        }
    }

    async processFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const result = this.fixBase64Format(e.target.result);


                    const fileData = {};

                    if (file.name != null) {
                        fileData.name = String(file.name);
                    }

                    if (file.type != null) {
                        fileData.type = String(file.type);
                    }

                    if (result != null) {
                        fileData.data = String(result);
                    }

                    if (file.size != null && !isNaN(Number(file.size))) {
                        fileData.size = Number(file.size);
                    }

                    if (file.type && file.type.startsWith('image/')) {
                        this.generateImageThumbnail(file, result).then(thumbnail => {
                            if (thumbnail != null) {
                                fileData.thumbnail = String(thumbnail);
                            }
                            resolve(fileData);
                        }).catch(() => {

                            if (result != null) {
                                fileData.thumbnail = String(result);
                            }
                            resolve(fileData);
                        });
                    } else if (file.type && file.type.startsWith('video/') && file.size < 5 * 1024 * 1024) {

                        this.generateVideoThumbnail(file).then(thumbnail => {
                            if (thumbnail != null) {
                                fileData.thumbnail = String(thumbnail);
                            }
                            resolve(fileData);
                        }).catch(() => {
                            resolve(fileData);
                        });
                    } else {
                        resolve(fileData);
                    }
                } catch (error) {
                    console.error('Error processing file data:', error);
                    reject(new Error('Dosya işlenirken hata oluştu: ' + error.message));
                }
            };

            reader.onerror = () => {
                reject(new Error('Dosya okunamadı'));
            };

            reader.readAsDataURL(file);
        });
    }

    async generateVideoThumbnail(file) {
        return new Promise((resolve) => {
            try {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.muted = true;

                video.onloadedmetadata = () => {
                    video.currentTime = Math.min(1, video.duration / 2);
                };

                video.onseeked = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = 200;
                        canvas.height = 200;
                        const ctx = canvas.getContext('2d');

                        const aspectRatio = video.videoWidth / video.videoHeight;
                        let drawWidth = 200;
                        let drawHeight = 200;

                        if (aspectRatio > 1) {
                            drawHeight = 200 / aspectRatio;
                        } else {
                            drawWidth = 200 * aspectRatio;
                        }

                        const x = (200 - drawWidth) / 2;
                        const y = (200 - drawHeight) / 2;

                        ctx.drawImage(video, x, y, drawWidth, drawHeight);
                        const thumbnail = this.fixBase64Format(canvas.toDataURL('image/jpeg', 0.7));

                        URL.revokeObjectURL(video.src);

                        resolve(thumbnail);
                    } catch (error) {
                        console.error('Error generating video thumbnail:', error);
                        resolve(null);
                    }
                };

                video.onerror = () => {
                    console.error('Video load error for thumbnail generation');
                    resolve(null);
                };

                video.src = URL.createObjectURL(file);
            } catch (error) {
                console.error('Error in generateVideoThumbnail:', error);
                resolve(null);
            }
        });
    }

    async generateImageThumbnail(file, originalData, maxWidth = 200, maxHeight = 200) {
        return new Promise((resolve) => {
            try {
                const img = new Image();

                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');

                        let { width, height } = img;

                        if (width > height) {
                            if (width > maxWidth) {
                                height = (height * maxWidth) / width;
                                width = maxWidth;
                            }
                        } else {
                            if (height > maxHeight) {
                                width = (width * maxHeight) / height;
                                height = maxHeight;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;

                        ctx.drawImage(img, 0, 0, width, height);
                        const thumbnailData = this.fixBase64Format(canvas.toDataURL(file.type, 0.7)); // 70% quality

                        resolve(thumbnailData);
                    } catch (error) {
                        console.error('Error generating image thumbnail:', error);
                        const fixedOriginal = this.fixBase64Format(originalData);
                        resolve(fixedOriginal);
                    }
                };

                img.onerror = () => {
                    console.error('Image load error for thumbnail generation');
                    const fixedOriginal = this.fixBase64Format(originalData);
                    resolve(fixedOriginal);
                };

                img.src = originalData;
            } catch (error) {
                console.error('Error in generateImageThumbnail:', error);
                const fixedOriginal = this.fixBase64Format(originalData);
                resolve(fixedOriginal);
            }
        });
    }
    handleTyping() {
        if (!this.currentConversation || !this.socket) return;

        this.socket.emit('typing_start', {
            conversationId: this.currentConversation._id,
            sessionId: this.currentConversation.sessionId
        });

        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => {
            this.stopTyping();
        }, 1000);
    }

    stopTyping() {
        if (this.socket && this.currentConversation) {
            this.socket.emit('typing_stop', {
                conversationId: this.currentConversation._id,
                sessionId: this.currentConversation.sessionId
            });
        }
    }

    showTypingIndicatorInHeader(username) {
        const typingIndicatorHeader = document.getElementById('typingIndicatorHeader');
        const normalStatus = document.getElementById('normalStatus');

        normalStatus.classList.add('hidden');
        typingIndicatorHeader.classList.remove('hidden');

        if (this.typingTimeoutId) {
            clearTimeout(this.typingTimeoutId);
        }

        this.typingTimeoutId = setTimeout(() => {
            this.hideTypingIndicatorInHeader();
        }, 3000);
    }

    hideTypingIndicatorInHeader() {
        const typingIndicatorHeader = document.getElementById('typingIndicatorHeader');
        const normalStatus = document.getElementById('normalStatus');

        typingIndicatorHeader.classList.add('hidden');
        normalStatus.classList.remove('hidden');

        if (this.typingTimeoutId) {
            clearTimeout(this.typingTimeoutId);
            this.typingTimeoutId = null;
        }
    }

    initializeSocket() {
        if (!this.accessToken) return;

        this.socket = io(this.apiUrl, {
            auth: {
                token: this.accessToken,
                sessionId: this.sessionId
            },
            timeout: 60000,
            forceNew: true,
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
            maxHttpBufferSize: 1e8
        });

        this.socket.on('connect', () => {
            this.showToast('Bağlantı kuruldu', 'success');
        });

        this.socket.on('disconnect', () => {
            this.showToast('Bağlantı kesildi', 'error');
        });

        this.socket.on('message_received', (data) => {
            const messageKey = data.message.messageId || data.message._id;
            if (this.messageDeduplication.has(messageKey)) {
                return;
            }
            this.messageDeduplication.add(messageKey);
            if (data.message.sender._id !== this.currentUser.id) {
                if (this.currentConversation && data.conversation._id === this.currentConversation._id) {
                    this.addNewMessage(data.message);

                    this.markMessagesAsRead([data.message._id]);

                    this.playNotificationSound();
                } else {
                    this.updateUnreadCount(data.message.sender._id);
                }
            } else {
                const pendingMessageId = data.message.messageId || data.message._id;

                this.updatePendingMessage(pendingMessageId, data.message);

                if (data.message.messageId) {
                    this.pendingMessages.delete(data.message.messageId);
                }
            }
        });

        this.socket.on('message_sent', (data) => {
            if (data.messageId) {
                this.pendingMessages.delete(data.messageId);

                const messageIndex = this.messages.findIndex(m =>
                    m.messageId === data.messageId && m.isPending
                );

                if (messageIndex !== -1) {
                    this.messages[messageIndex].metadata.deliveryStatus = 'sent';
                    this.messages[messageIndex].isPending = false;

                    this.updatePendingMessage(data.messageId, this.messages[messageIndex]);
                }
            }
        });

        this.socket.on('messages_read', (data) => {
            this.updateMessageReadStatus(data.messageIds);
        });

        this.socket.on('message_delivered', (data) => {
            this.updateMessageDeliveryStatus(data.messageId, 'delivered');
        });

        this.socket.on('message_read_receipt', (data) => {
            this.updateMessageDeliveryStatus(data.messageId, 'read');
        });

        this.socket.on('unread_count_updated', (data) => {
            const user = this.users.find(u => u._id === data.senderId);
            if (user) {
                user.unreadCount = data.unreadCount;
                this.renderUsers();
            }
        });

        this.socket.on('user_online', (data) => {
            this.updateUserOnlineStatus(data.userId, true);
            this.updateOnlineCount();
        });

        this.socket.on('user_offline', (data) => {
            this.updateUserOnlineStatus(data.userId, false, data.lastSeen);
            this.updateOnlineCount();
        });

        this.socket.on('new_user_joined', (data) => {
            const existingUser = this.users.find(u => u._id === data.user._id);
            if (!existingUser) {
                this.users.push(data.user);
                this.filteredUsers = [...this.users];
                this.renderUsers();
                document.getElementById('userCount').textContent = this.users.length;
                this.showToast(`${data.user.firstName} ${data.user.lastName} sisteme katıldı`, 'info');
            }
        });

        this.socket.on('user_typing', (data) => {
            if (this.currentConversation &&
                this.selectedUser &&
                data.userId === this.selectedUser._id &&
                data.userId !== this.currentUser.id) {
                this.showTypingIndicatorInHeader(data.username);
            }
        });

        this.socket.on('user_stop_typing', (data) => {
            if (this.currentConversation &&
                this.selectedUser &&
                data.userId === this.selectedUser._id) {
                this.hideTypingIndicatorInHeader();
            }
        });

        this.socket.on('message_deleted_for_everyone', (data) => {
            const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageElement) {
                const contentElement = messageElement.querySelector('.message-sent, .message-received');
                if (contentElement) {
                    const timeElement = contentElement.querySelector('p[title]').parentElement;
                    contentElement.innerHTML = `
                        <p class="text-sm italic opacity-60">Bu mesaj silindi</p>
                        ${timeElement.outerHTML}
                    `;
                }
            }

            const messageIndex = this.messages.findIndex(msg => msg._id === data.messageId);
            if (messageIndex !== -1) {
                this.messages[messageIndex].isDeleted = true;
                this.messages[messageIndex].content = 'Bu mesaj silindi';
            }
        });

        this.socket.on('message_deleted_for_me', (data) => {
            const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }

            this.messages = this.messages.filter(msg => msg._id !== data.messageId);
        });

        this.socket.on('multiple_messages_deleted', (data) => {
            data.deletedMessageIds.forEach(messageId => {
                const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
                if (messageElement) {
                    messageElement.remove();
                }
            });

            this.messages = this.messages.filter(msg => !data.deletedMessageIds.includes(msg._id));

            this.showToast(`${data.deletedCount} mesaj silindi`, 'success');
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            this.showToast('Bağlantı hatası oluştu', 'error');
        });

        this.socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
            this.showToast('Sunucuya bağlanılamadı', 'error');
        });

        this.socket.on('reconnect', (attemptNumber) => {
            this.showToast('Bağlantı yeniden kuruldu', 'success');
        });

        this.socket.on('reconnect_error', (error) => {
            console.error('Socket reconnection error:', error);
            this.showToast('Bağlantı kurulamadı', 'error');
        });
    }

    updateUnreadCount(senderId) {
        const user = this.users.find(u => u._id === senderId);
        if (user) {
            user.unreadCount = (user.unreadCount || 0) + 1;
            this.renderUsers();
        }
    }

    updateMessageReadStatus(messageIds) {
        this.messages.forEach(message => {
            if (messageIds.includes(message._id)) {
                if (!message.metadata) message.metadata = {};
                message.metadata.deliveryStatus = 'read';
            }
        });
        messageIds.forEach(messageId => {
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                const statusIcon = messageElement.querySelector('.message-sent, .message-received').lastElementChild.lastElementChild;
                if (statusIcon) {
                    statusIcon.innerHTML = `<div class="text-success text-opacity-90"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7M5 13l4 4L19 7"/></svg></div>`;
                }
            }
        });
    }

    updateMessageDeliveryStatus(messageId, status) {
        const message = this.messages.find(msg =>
            msg.messageId === messageId || msg._id === messageId
        );
        if (message) {
            if (!message.metadata) message.metadata = {};
            message.metadata.deliveryStatus = status;

            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                const statusIcon = messageElement.querySelector('.message-sent, .message-received').lastElementChild.lastElementChild;
                if (statusIcon) {
                    statusIcon.innerHTML = this.getDeliveryStatusIcon(status, true);
                }
            }
        }
    }

    playNotificationSound() {
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRpQDAABXQVZFZm10IBAAAAABAAEDAA0dAACZaQAAQAMAAgAQAGRhdGFgAwAAASABAUgBSAF2AXYBJAIkArgCuAJJA0kD0wPTA14EXgTqBOoEcwVzBfgF+AWBBoEGBgcGBzUNkAQUBLADBgNhAm4CFQEbANP+0/6z/fb9bv3S/Fr8xvtq+xT7vvpm+hj6xPlm+Rr5xfhm+Bj4xfdm9wP3v/Zm9hH2kPVC9SH1kPRC9CH0kPNC9CH3ofRC9CH0kPNC9CH0kfRC9CH0kPNC9CH0kfNF9CH3kPNC9CH0kfNF9CL0QPNy9CPzQfNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/HykPNy8/H===');
            audio.volume = 0.1;
            audio.play().catch(() => {});
        } catch (error) {
        }
    }

    updateUserOnlineStatus(userId, isOnline, lastSeen = null) {
        const user = this.users.find(u => u._id === userId);
        if (user) {
            user.isOnline = isOnline;
            if (lastSeen) {
                user.lastSeen = lastSeen;
            }
        }

        if (this.selectedUser && this.selectedUser._id === userId) {
            this.selectedUser.isOnline = isOnline;
            if (lastSeen) {
                this.selectedUser.lastSeen = lastSeen;
            }
            this.updateChatHeader();
        }

        this.renderUsers();
    }

    async updateOnlineCount() {
        try {
            const response = await this.apiCall('/api/user/online-count');
            if (response.success) {
                document.getElementById('onlineCount').textContent = response.data.count;
            }
        } catch (error) {
        }
    }

    async logout() {
        try {
            if (this.socket) {
                this.socket.disconnect();
            }

            await this.apiCall('/api/auth/logout', {
                method: 'POST'
            });
        } catch (error) {
        } finally {
            this.clearAuth();
            this.showToast('Başarıyla çıkış yapıldı', 'success');
        }
    }

    clearAuth() {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');

        this.isAuthenticated = false;
        this.currentUser = null;
        this.accessToken = null;
        this.refreshToken = null;
        this.users = [];
        this.selectedUser = null;
        this.messages = [];
        this.currentConversation = null;
        this.pendingMessages.clear();
        this.messageDeduplication.clear();

        document.getElementById('chatContainer').classList.add('hidden');
        document.getElementById('authContainer').classList.remove('hidden');
    }

    async apiCall(url, options = {}) {
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': this.sessionId,
                ...(this.accessToken && { 'Authorization': `Bearer ${this.accessToken}` })
            },
            ...options
        };

        const response = await fetch(`${this.apiUrl}${url}`, config);

        if (response.status === 401) {
            if (this.refreshToken) {
                try {
                    const refreshResponse = await fetch(`${this.apiUrl}/api/auth/refresh`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Session-ID': this.sessionId
                        },
                        body: JSON.stringify({ refreshToken: this.refreshToken })
                    });

                    const refreshData = await refreshResponse.json();
                    if (refreshData.success) {
                        this.accessToken = refreshData.data.tokens.accessToken;
                        this.refreshToken = refreshData.data.tokens.refreshToken;
                        localStorage.setItem('accessToken', this.accessToken);
                        localStorage.setItem('refreshToken', this.refreshToken);

                        config.headers.Authorization = `Bearer ${this.accessToken}`;
                        return fetch(`${this.apiUrl}${url}`, config).then(res => res.json());
                    }
                } catch (refreshError) {
                }
            }

            this.clearAuth();
            throw new Error('Authentication failed');
        }

        return response.json();
    }

    setLoading(buttonId, isLoading) {
        const button = document.getElementById(buttonId);

        if (isLoading) {
            button.disabled = true;
            const originalHtml = button.innerHTML;
            button.dataset.originalHtml = originalHtml;
            button.innerHTML = '<div class="spinner mx-auto"></div>';
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalHtml || button.innerHTML;
        }
    }

    showError(message) {
        const errorAlert = document.getElementById('errorAlert');
        const errorMessage = document.getElementById('errorMessage');

        if (message.includes('\n')) {
            const lines = message.split('\n');
            errorMessage.innerHTML = lines.map(line =>
                `<div class="mb-1">${this.escapeHtml(line)}</div>`
            ).join('');
        } else {
            errorMessage.textContent = message;
        }

        errorAlert.classList.remove('hidden');

        setTimeout(() => {
            errorAlert.classList.add('hidden');
        }, 8000);
    }

    hideError() {
        document.getElementById('errorAlert').classList.add('hidden');
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        const toastMessage = document.getElementById('toastMessage');
        const toastIcon = document.getElementById('toastIcon');

        toastMessage.textContent = message;

        toastIcon.removeAttribute('class');
        toastIcon.innerHTML = '';

        if (type === 'success') {
            toastIcon.setAttribute('class', 'w-6 h-6 text-success');
            toastIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>';
        } else if (type === 'error') {
            toastIcon.setAttribute('class', 'w-6 h-6 text-error');
            toastIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>';
        } else {
            toastIcon.setAttribute('class', 'w-6 h-6 text-primary-500');
            toastIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>';
        }

        toast.classList.remove('hidden');

        setTimeout(() => {
            this.hideToast();
        }, 4000);
    }

    hideToast() {
        document.getElementById('toast').classList.add('hidden');
    }

    formatTime(dateString) {
        return new Date(dateString).toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    scrollToBottom() {
        const messagesArea = document.getElementById('messagesArea');
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }
}
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
});