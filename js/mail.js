/* global Handlebars, Marionette, Notification, relative_modified_date, formatDate, humanFileSize, views */
var Mail = {
	State: {
		currentFolderId: null,
		currentAccountId: null,
		currentMessageId: null,
		currentlyLoading: null,
		accounts: null,
		messageView: null,
		composeView: null,
		router: null,
		Cache: null
	},
	Search: {
		timeoutID: null,
		attach: function (search) {
			search.setFilter('mail', Mail.Search.filter);
		},
		filter: function (query) {
			window.clearTimeout(Mail.Search.timeoutID);
			Mail.Search.timeoutID = window.setTimeout(function() {
				Mail.State.messageView.filterCurrentMailbox(query);
			}, 500);
			$('#searchresults').hide();
		}
	},
    /*jshint maxparams: 6 */
    /* Todo: Refactor if you are touching
       https://jslinterrors.com/this-function-has-too-many-parameters
     */
	BackGround: {
		showNotification: function (title, body, tag, icon, accountId, folderId) {
			// notifications not supported -> go away
			if (typeof Notification === 'undefined') {
				return;
			}
			// browser is active -> go away
			var isWindowFocused = document.querySelector(':focus') !== null;
			if (isWindowFocused) {
				return;
			}
			var notification = new Notification(
				title,
				{
					body: body,
					tag: tag,
					icon: icon
				}
			);
			notification.onclick = function() {
				Mail.UI.loadMessages(accountId, folderId, false);
				window.focus();
			};
			setTimeout(function () {
				notification.close();
			}, 5000);
		},
		showMailNotification: function (email, folder) {
			if (Notification.permission === "granted" && folder.messages.length > 0) {
				var from = _.map(folder.messages, function (m) {
					return m.from;
				});
				from = _.uniq(from);
				if (from.length > 2) {
					from = from.slice(0, 2);
					from.push('…');
				} else {
					from = from.slice(0, 2);
				}
				var body = n('mail',
					'%n new message in {folderName} \nfrom {from}',
					'%n new messages in {folderName} \nfrom {from}',
					folder.messages.length, {
						folderName: folder.name,
						from: from.join()
					});
				// If it's okay let's create a notification
				var tag = 'not-' + folder.accountId + '-' + folder.name;
				var icon = OC.filePath('mail', 'img', 'mail-notification.png');
				Mail.BackGround.showNotification(email, body, tag, icon, folder.accountId, folder.id);
			}
		},
		checkForNotifications: function() {
			_.each(Mail.State.accounts, function (a) {
				var localAccount = Mail.State.folderView.collection.get(a.accountId);
				var folders = localAccount.get('folders');

				$.ajax(
					OC.generateUrl('apps/mail/accounts/{accountId}/folders/detectChanges', {accountId: a.accountId}), {
						data: JSON.stringify({folders: folders.toJSON()}),
						contentType: "application/json; charset=utf-8",
						dataType: "json",
						type: 'POST',
						success: function(jsondata) {
							_.each(jsondata, function(f) {
								// send notification
								if (f.newUnReadCounter > 0) {
									Mail.UI.changeFavicon(OC.filePath('mail', 'img', 'favicon-notification.png'));
									Mail.BackGround.showMailNotification(localAccount.get('email'), f);
								}

								// update folder status
								var localFolder = folders.get(f.id);
								localFolder.set('uidvalidity', f.uidvalidity);
								localFolder.set('uidnext', f.uidnext);
								localFolder.set('unseen', f.unseen);
								localFolder.set('total', f.total);

								// reload if current selected folder has changed
								if (Mail.State.currentAccountId === f.accountId &&
									Mail.State.currentFolderId === f.id) {
									Mail.State.messageView.collection.add(f.messages);
								}

								Mail.State.folderView.updateTitle();
							});
						}

					}
				);
			});
		}
	},
	Communication: {
		get: function (url, options) {
			var defaultOptions = {
					ttl: 60000,
					cache: true,
					key: url
				},
				allOptions = options || {};
			_.defaults(allOptions, defaultOptions);

			// don't cache for the time being
			allOptions.cache = false;
			if (allOptions.cache) {
				var cache = $.initNamespaceStorage(allOptions.key).localStorage;
				var ttl = cache.get('ttl');
				if (ttl && ttl < Date.now()) {
					cache.removeAll();
				}
				var item = cache.get('data');
				if (item) {
					options.success(item);
					return;
				}
			}
			return $.ajax(url, {
				data: {},
				type: 'GET',
				error: function (xhr, textStatus) {
					options.error(textStatus);
				},
				success: function (data) {
					if (allOptions.cache) {
						cache.set('data', data);
						if (typeof allOptions.ttl === 'number') {
							cache.set('ttl', Date.now() + allOptions.ttl);
						}
					}
					options.success(data);
				}
			});
		}
	},
	UI: {
		renderSettings: function () {
			var source   = $("#mail-settings-template").html();
			var template = Handlebars.compile(source);
			var html = template(Mail.State.accounts);
			$('#app-settings-content').html(html);
		},
		changeFavicon: function (src) {
			$('link[rel="shortcut icon"]').attr('href',src);
		},
		loadAccounts: function () {
			Mail.Communication.get(OC.generateUrl('apps/mail/accounts'), {
				success: function (jsondata) {
					Mail.State.accounts = jsondata;
					Mail.UI.renderSettings();
					if (jsondata.length === 0) {
						Mail.UI.addAccount();
					} else {
						var firstAccountId = jsondata[0].accountId;
						_.each(jsondata, function (a) {
							Mail.UI.loadFoldersForAccount(a.accountId, firstAccountId);
						});
					}
				},
				error: function () {
					Mail.UI.showError(t('mail', 'Error while loading the accounts.'));
				},
				ttl: 'no'
			});
		},
		initializeInterface: function () {
			Handlebars.registerHelper("relativeModifiedDate", function (dateInt) {
				var lastModified = new Date(dateInt * 1000);
				var lastModifiedTime = Math.round(lastModified.getTime() / 1000);
				return relative_modified_date(lastModifiedTime);
			});

			Handlebars.registerHelper("formatDate", function (dateInt) {
				var lastModified = new Date(dateInt * 1000);
				return formatDate(lastModified);
			});

			Handlebars.registerHelper("humanFileSize", function (size) {
				return humanFileSize(size);
			});

			Handlebars.registerHelper("printAddressList", function (addressList) {
				var currentAddress = _.find(Mail.State.accounts, function (item) {
					return item.accountId === Mail.State.currentAccountId;
				});

				var str = _.reduce(addressList, function (memo, value, index) {
					if (index !== 0) {
						memo += ', ';
					}
					var label = value.label
						.replace(/(^"|"$)/g, '')
						.replace(/(^'|'$)/g, '');
					label = Handlebars.Utils.escapeExpression(label);
					var email = Handlebars.Utils.escapeExpression(value.email);
					if (currentAddress && email === currentAddress.emailAddress) {
						label = t('mail', 'you');
					}
					return memo + '<span title="' + email + '">' + label + '</span>';
				}, "");
				return new Handlebars.SafeString(str);
			});

			Handlebars.registerHelper("printAddressListPlain", function (addressList) {
				var str = _.reduce(addressList, function (memo, value, index) {
					if (index !== 0) {
						memo += ', ';
					}
					var label = value.label
						.replace(/(^"|"$)/g, '')
						.replace(/(^'|'$)/g, '');
					label = Handlebars.Utils.escapeExpression(label);
					var email = Handlebars.Utils.escapeExpression(value.email);
					if (label === email) {
						return memo + email;
					} else {
						return memo + '"' + label + '" <' + email + '>';
					}
				}, "");
				return str;
			});

			Marionette.TemplateCache.prototype.compileTemplate = function (rawTemplate) {
				return Handlebars.compile(rawTemplate);
			};
			Marionette.ItemView.prototype.modelEvents = {"change": "render"};
			Marionette.CompositeView.prototype.modelEvents = {"change": "render"};

			// ask to handle all mailto: links
			if (window.navigator.registerProtocolHandler) {
				var url = window.location.protocol + '//' +
					window.location.host +
					OC.generateUrl('apps/mail/compose?uri=%s');
				window.navigator
					.registerProtocolHandler("mailto", url, "ownCloud Mail");
			}

			// setup messages view
			Mail.State.messageView = new views.Messages({
				el: $('#mail_messages')
			});
			Mail.State.messageView.render();

			// setup folder view
			Mail.State.folderView = new views.Folders({
				el: $('#folders')
			});
			Mail.State.folderView.render();

			Mail.State.folderView.listenTo(Mail.State.messageView, 'change:unseen',
				Mail.State.folderView.changeUnseen);

			// request permissions
			if(typeof Notification !== 'undefined') {
				Notification.requestPermission();
			}

			OC.Plugins.register('OCA.Search', Mail.Search);

			setInterval(Mail.BackGround.checkForNotifications, 5*60*1000);
			this.loadAccounts();
		},

		loadFoldersForAccount: function (accountId, firstAccountId) {

			$('#mail_messages').removeClass('hidden').addClass('icon-loading');
			$('#mail-message').removeClass('hidden').addClass('icon-loading');
			$('#mail_new_message').removeClass('hidden');
			$('#folders').removeClass('hidden');
			$('#mail-setup').addClass('hidden');

			Mail.UI.clearMessages();
			$('#app-navigation').addClass('icon-loading');

			Mail.Communication.get(OC.generateUrl('apps/mail/accounts/{accountId}/folders', {accountId: accountId}), {
				success: function (jsondata) {
					$('#app-navigation').removeClass('icon-loading');
					Mail.State.folderView.collection.add(jsondata);

					if (jsondata.id === firstAccountId) {
						var folderId = jsondata.folders[0].id;

						Mail.UI.loadMessages(accountId, folderId, false);

						// Save current folder
						Mail.UI.setFolderActive(accountId, folderId);
						Mail.State.currentAccountId = accountId;
						Mail.State.currentFolderId = folderId;
					}
				},
				error: function () {
					Mail.UI.showError(t('mail', 'Error while loading the selected account.'));
				},
				ttl: 'no'
			});
		},

		showError: function (message) {
			OC.Notification.showTemporary(message);
			$('#app-navigation')
				.removeClass('icon-loading');
			$('#app-content')
				.removeClass('icon-loading');
			$('#mail-message')
				.removeClass('icon-loading');
			$('#mail_message')
				.removeClass('icon-loading');
		},

		clearMessages: function () {
			Mail.State.messageView.collection.reset();
			$('#messages-loading').fadeIn();

			$('#mail-message')
				.html('')
				.addClass('icon-loading');
		},

		hideMenu: function () {
			$('#new-message').addClass('hidden');
			if (Mail.State.accounts.length === 0) {
				$('#app-navigation').hide();
				$('#app-navigation-toggle').css('background-image', 'none');
			}
		},

		showMenu: function () {
			$('#new-message').removeClass('hidden');
			$('#app-navigation').show();
			$('#app-navigation-toggle').css('background-image', '');
		},

		addMessages: function (data) {
			Mail.State.messageView.collection.add(data);
		},

		loadMessages: function (accountId, folderId, noSelect) {
			if (Mail.State.currentlyLoading !== null) {
				Mail.State.currentlyLoading.abort();
			}
			// Set folder active
			Mail.UI.setFolderActive(accountId, folderId);
			Mail.UI.clearMessages();
			$('#mail_messages')
				.removeClass('hidden')
				.addClass('icon-loading')
				.removeClass('hidden');
			$('#mail_new_message')
				.removeClass('hidden')
				.fadeIn();
			$('#mail-message').removeClass('hidden');
			$('#folders').removeClass('hidden');
			$('#mail-setup').addClass('hidden');


			$('#load-new-mail-messages').hide();
			$('#load-more-mail-messages').hide();
			$('#emptycontent').hide();

			if (noSelect) {
				$('#emptycontent').show();
				$('#mail-message').removeClass('icon-loading');
				Mail.State.currentAccountId = accountId;
				Mail.State.currentFolderId = folderId;
				Mail.UI.setMessageActive(null);
				$('#mail_messages').removeClass('icon-loading');
				Mail.State.currentlyLoading = null;
			} else {
				Mail.State.currentlyLoading = Mail.Communication.get(
					OC.generateUrl('apps/mail/accounts/{accountId}/folders/{folderId}/messages',
						{'accountId': accountId, 'folderId': folderId}), {
						success: function (jsondata) {
							Mail.State.currentlyLoading = null;
							Mail.State.currentAccountId = accountId;
							Mail.State.currentFolderId = folderId;
							Mail.UI.setMessageActive(null);
							$('#mail_messages').removeClass('icon-loading');

							// Fade out the message composer
							$('#mail_new_message').prop('disabled', false);

							if (jsondata.length > 0) {
								Mail.UI.addMessages(jsondata);
								var messageId = jsondata[0].id;
								Mail.UI.openMessage(messageId);
								// Show 'Load More' button if there are
								// more messages than the pagination limit
								if (jsondata.length > 20) {
									$('#load-more-mail-messages')
										.fadeIn()
										.css('display', 'block');
								}
							} else {
								$('#emptycontent').show();
								$('#mail-message').removeClass('icon-loading');
							}
							$('#load-new-mail-messages')
								.fadeIn()
								.css('display', 'block')
								.prop('disabled', false);

						},
						error: function (textStatus) {
							if (textStatus !== 'abort') {
								// Set the old folder as being active
								Mail.UI.setFolderActive(Mail.State.currentAccountId, Mail.State.currentFolderId);
								Mail.UI.showError(t('mail', 'Error while loading messages.'));
							}
						},
						cache: false
					});
			}
		},

		saveAttachment: function (messageId, attachmentId) {
			OC.dialogs.filepicker(
				t('mail', 'Choose a folder to store the attachment in'),
				function (path) {
					// Loading feedback
					var saveToFilesBtnSelector = '.attachment-save-to-cloud';
					if (typeof attachmentId !== "undefined") {
						saveToFilesBtnSelector = 'li[data-attachment-id="' +
							attachmentId + '"] ' + saveToFilesBtnSelector;
					}
					$(saveToFilesBtnSelector)
						.removeClass('icon-upload')
						.addClass('icon-loading-small')
						.prop('disabled', true);

					$.ajax(
						OC.generateUrl(
							'apps/mail/accounts/{accountId}/' +
								'folders/{folderId}/messages/{messageId}/' +
								'attachment/{attachmentId}',
							{
							accountId: Mail.State.currentAccountId,
							folderId: Mail.State.currentFolderId,
							messageId: messageId,
							attachmentId: attachmentId
						}), {
							data: {
								targetPath: path
							},
							type: 'POST',
							success: function () {
								if (typeof attachmentId === "undefined") {
									Mail.UI.showError(t('mail', 'Attachments saved to Files.'));
								} else {
									Mail.UI.showError(t('mail', 'Attachment saved to Files.'));
								}
							},
							error: function () {
								if (typeof attachmentId === "undefined") {
									Mail.UI.showError(t('mail', 'Error while saving attachments to Files.'));
								} else {
									Mail.UI.showError(t('mail', 'Error while saving attachment to Files.'));
								}
							},
							complete: function () {
								// Remove loading feedback again
								$('.attachment-save-to-cloud')
									.removeClass('icon-loading-small')
									.addClass('icon-upload')
									.prop('disabled', false);
							}
						});
				},
				false,
				'httpd/unix-directory',
				true
			);
		},

		openComposer: function(data) {
			$('#mail_new_message').prop('disabled', true);

			if (Mail.State.composeView === null) {
				// setup sendmail view
				Mail.State.composeView = new views.SendMail({
					el: $('#mail-message'),
					aliases: Mail.State.accounts,
					data: data
				});

				Mail.State.composeView.sentCallback = function () {};
			} else {
				Mail.State.composeView.data = data;
			}

			if (data && data.hasHtmlBody) {
				Mail.UI.showError(t('mail', 'Opening HTML drafts is not supported yet.'));
			}

			Mail.State.composeView.attachments.reset();
			Mail.State.composeView.render();

			// focus 'to' field automatically on clicking New message button
			$('#to').focus();

			Mail.UI.setMessageActive(null);
		},

		loadDraft: function(messageId) {
			var storage = $.localStorage;
			var draftId = 'draft' +
				'.' + Mail.State.currentAccountId.toString() +
				'.' + Mail.State.currentFolderId.toString() +
				'.' + messageId.toString();
			if (storage.isSet(draftId)) {
				return storage.get(draftId);
			} else {
				return null;
			}
		},

		openMessage: function (messageId, force) {
			// Do not reload email when clicking same again
			if (Mail.State.currentMessageId === messageId) {
				return;
			}
			force = force || false;
			if (!force && $('#new-message').length) {
				return;
			}

			// check if message is a draft
			var accountId = Mail.State.currentAccountId;
			var account = Mail.State.folderView.collection.findWhere({id: accountId});
			var draftsFolder = account.attributes.specialFolders.drafts;
			var draft = draftsFolder === Mail.State.currentFolderId;

			// close email first
			// Check if message is open
			if (Mail.State.currentMessageId !== null) {
				var lastMessageId = Mail.State.currentMessageId;
				Mail.UI.setMessageActive(null);
				if (lastMessageId === messageId) {
					return;
				}
			}

			var mailBody = $('#mail-message');
			mailBody.html('').addClass('icon-loading');

			// Set current Message as active
			Mail.UI.setMessageActive(messageId);

			// Fade out the message composer
			$('#mail_new_message').prop('disabled', false);

			var self = this;
			var loadMessageSuccess = function (data) {
				// load local storage draft
				var draft = self.loadDraft(messageId);
				if (draft) {
					data.replyCc = draft.cc;
					data.replyBcc = draft.bcc;
					data.replyBody = draft.body;
				}

				// Render the message body
				var source = $("#mail-message-template").html();
				var template = Handlebars.compile(source);
				var html = template(data);
				mailBody
					.html(html)
					.removeClass('icon-loading');

				Mail.State.messageView.setMessageFlag(messageId, 'unseen', false);

				// HTML mail rendering
				$('iframe').load(function () {
					// Expand height to not have two scrollbars
					$(this).height($(this).contents().find('html').height() + 20);
					// Fix styling
					$(this).contents().find('body').css({
						'margin': '0',
						'font-weight': 'normal',
						'font-size': '.8em',
						'line-height': '1.6em',
						'font-family': "'Open Sans', Frutiger, Calibri, 'Myriad Pro', Myriad, sans-serif",
						'color': '#000'
					});
					// Fix font when different font is forced
					$(this).contents().find('font').prop({
						'face': 'Open Sans',
						'color': '#000'
					});
					$(this).contents().find('.moz-text-flowed').css({
						'font-family': 'inherit',
						'font-size': 'inherit'
					});
					// Expand height again after rendering to account for new size
					$(this).height($(this).contents().find('html').height() + 20);
					// Grey out previous replies
					$(this).contents().find('blockquote').css({
						'-ms-filter': '"progid:DXImageTransform.Microsoft.Alpha(Opacity=50)"',
						'filter': 'alpha(opacity=50)',
						'opacity': '.5'
					});
					// Remove spinner when loading finished
					$('iframe').parent().removeClass('icon-loading');

				});

				$('textarea').autosize({append: '"\n\n"'});
			};
			
			var loadDraftSuccess = function(data) {
				self.openComposer(data);
			};

			$.ajax(
				OC.generateUrl('apps/mail/accounts/{accountId}/folders/{folderId}/messages/{messageId}',
					{
					accountId: Mail.State.currentAccountId,
					folderId: Mail.State.currentFolderId,
					messageId: messageId
				}), {
					data: {},
					type: 'GET',
					success: function (data) {
						if (draft) {
							loadDraftSuccess(data);
						} else {
							loadMessageSuccess(data);
						}
					},
					error: function () {
						Mail.UI.showError(t('mail', 'Error while loading the selected message.'));
					}
				});
		},

		setFolderActive: function (accountId, folderId) {
			Mail.State.messageView.clearFilter();

			// disable all other folders for all accounts
			_.each(Mail.State.accounts, function (account) {
				var localAccount = Mail.State.folderView.collection.get(account.accountId);
				var folders = localAccount.get('folders');
				_.each(folders.models, function(folder) {
					folders.get(folder).set('active', false);
				});
			});

			Mail.State.folderView.collection.get(accountId)
				.get('folders')
				.get(folderId)
				.set('active', true);
		},

		setMessageActive: function (messageId) {
			Mail.State.messageView.setActiveMessage(messageId);
			Mail.State.currentMessageId = messageId;
			Mail.State.folderView.updateTitle();
		},

		addAccount: function () {
			$('#mail_messages').addClass('hidden');
			$('#mail-message').addClass('hidden');
			$('#mail_new_message').addClass('hidden');
			$('#app-navigation').removeClass('icon-loading');

			Mail.UI.hideMenu();

			$('#mail-setup').removeClass('hidden');
			// don't show New Message button on Add account screen
			$('#mail_new_message').hide();
		},

		toggleSendButton:function () {
			if(($('#to').val() !== '') && (($('#subject').val() !== '') || ($('#new-message-body').val() !== ''))) {
				$('#new-message-send').removeAttr('disabled');
			} else {
				$('#new-message-send').attr('disabled', true);
			}
		},

		toggleReplyButton:function () {
			if(($('.reply-message-fields #to').val() !== '') && ($('.reply-message-body').val() !== '')) {
				$('.reply-message-send').removeAttr('disabled');
			} else {
				$('.reply-message-send').attr('disabled', true);
			}
		},

		toggleManualSetup:function() {
			$('#mail-setup-manual').slideToggle();
			$('#mail-imap-host').focus();
			if($('#mail-address').parent().prop('class') === 'groupmiddle') {
				$('#mail-password').slideToggle(function() {
					$('#mail-address').parent()
						.removeClass('groupmiddle').addClass('groupbottom');
				});
			} else {
				$('#mail-password').slideToggle();
				$('#mail-address').parent()
					.removeClass('groupbottom').addClass('groupmiddle');
			}
		}
	}
};

$(document).ready(function () {
	Mail.UI.initializeInterface();

	// auto detect button handling
	$('#auto_detect_account').click(function (event) {
		event.preventDefault();
		$('#mail-account-name, #mail-address, #mail-password, #mail-setup-manual-toggle')
			.prop('disabled', true);
		$('#mail-imap-host, #mail-imap-port, #mail-imap-sslmode, #mail-imap-user, #mail-imap-password')
			.prop('disabled', true);
		$('#mail-smtp-host, #mail-smtp-port, #mail-smtp-sslmode, #mail-smtp-user, #mail-smtp-password')
			.prop('disabled', true);

		$('#auto_detect_account')
			.prop('disabled', true)
			.val(t('mail', 'Connecting …'));
		$('#connect-loading').fadeIn();
		var emailAddress = $('#mail-address').val();
		var accountName = $('#mail-account-name').val();
		var password = $('#mail-password').val();

		var dataArray = {
			accountName: accountName,
			emailAddress: emailAddress,
			password: password,
			autoDetect: true
		};

		// if manual setup is open, use manual values
		if ($('#mail-setup-manual').css('display') === 'block') {
			dataArray = {
				accountName: accountName,
				emailAddress: emailAddress,
				password: password,
				imapHost: $('#mail-imap-host').val(),
				imapPort: $('#mail-imap-port').val(),
				imapSslMode: $('#mail-imap-sslmode').val(),
				imapUser: $('#mail-imap-user').val(),
				imapPassword: $('#mail-imap-password').val(),
				smtpHost: $('#mail-smtp-host').val(),
				smtpPort: $('#mail-smtp-port').val(),
				smtpSslMode: $('#mail-smtp-sslmode').val(),
				smtpUser: $('#mail-smtp-user').val(),
				smtpPassword: $('#mail-smtp-password').val(),
				autoDetect: false
			};
		}

		$.ajax(OC.generateUrl('apps/mail/accounts'), {
			data: dataArray,
			type:'POST',
			success:function () {
				// reload accounts
				Mail.UI.loadAccounts();
			},
			error: function (jqXHR, textStatus, errorThrown) {
				switch (jqXHR.status) {
				case 400:
					var response = JSON.parse(jqXHR.responseText);
					Mail.UI.showError(t('mail', response.message));
					break;
				default:
					var error = errorThrown || textStatus || t('mail', 'Unknown error');
					Mail.UI.showError(t('mail', 'Error while creating an account: ' + error));
				}
			},
			complete: function () {
				$('#mail-account-name, #mail-address, #mail-password, #mail-setup-manual-toggle')
					.prop('disabled', false);
				$('#mail-imap-host, #mail-imap-port, #mail-imap-sslmode, #mail-imap-user, #mail-imap-password')
					.prop('disabled', false);
				$('#mail-smtp-host, #mail-smtp-port, #mail-smtp-sslmode, #mail-smtp-user, #mail-smtp-password')
					.prop('disabled', false);
				$('#auto_detect_account')
					.prop('disabled', false)
					.val(t('mail', 'Connect'));
				$('#connect-loading').hide();

				Mail.UI.showMenu();
			}
		});
	});

	// set standard port for the selected IMAP & SMTP security

	$(document).on('change', '#mail-imap-sslmode', function () {
		var imapDefaultPort = 143;
		var imapDefaultSecurePort = 993;

		switch ($(this).val()) {
		case 'none':
		case 'tls':
			$('#mail-imap-port').val(imapDefaultPort);
			break;
		case 'ssl':
			$('#mail-imap-port').val(imapDefaultSecurePort);
			break;
		}
	});

	$(document).on('change', '#mail-smtp-sslmode', function () {
		var smtpDefaultPort = 587;
		var smtpDefaultSecurePort = 465;

		switch ($(this).val()) {
		case 'none':
		case 'tls':
			$('#mail-smtp-port').val(smtpDefaultPort);
			break;
		case 'ssl':
			$('#mail-smtp-port').val(smtpDefaultSecurePort);
			break;
		}
	});

	// toggle for advanced account configuration
	$(document).on('click', '#mail-setup-manual-toggle', function () {
		Mail.UI.toggleManualSetup();
	});

	// new mail message button handling
	$(document).on('click', '#mail_new_message', Mail.UI.openComposer);

	// disable send/reply buttons unless recipient and either subject or message body is filled
	$(document).on('change input paste keyup', '#to', Mail.UI.toggleSendButton);
	$(document).on('change input paste keyup', '#subject', Mail.UI.toggleSendButton);
	$(document).on('change input paste keyup', '#new-message-body', Mail.UI.toggleSendButton);
	$(document).on('change input paste keyup', '.reply-message-fields #to', Mail.UI.toggleReplyButton);
	$(document).on('change input paste keyup', '.reply-message-body', Mail.UI.toggleReplyButton);

	$(document).on('click', '#mail-message .attachment-save-to-cloud', function(event) {
		event.stopPropagation();
		var messageId = $(this).parent().data('messageId');
		var attachmentId = $(this).parent().data('attachmentId');
		Mail.UI.saveAttachment(messageId, attachmentId);
	});

	$(document).on('click', '#mail-message .attachments-save-to-cloud', function (event) {
		event.stopPropagation();
		var messageId = $(this).data('messageId');
		Mail.UI.saveAttachment(messageId);
	});

	$(document).on('show', function() {
		Mail.UI.changeFavicon(OC.filePath('mail', 'img', 'favicon.png'));
	});

});
