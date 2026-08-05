'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

//https://auth0.com/docs/api-auth/tutorials/authorization-code-grant-pkce
var AuthService = function () {
    function AuthService(config) {
        _classCallCheck(this, AuthService);

        this.config = config;
    }

    _createClass(AuthService, [{
        key: 'requestAuthCode',
        value: function requestAuthCode() {
            this.challengePair = AuthService.getPKCEChallengePair();
            return this.getAuthoriseUrl(this.challengePair);
        }
    }, {
        key: 'requestAccessCode',
        value: function requestAccessCode(callbackUrl, createmainWindow, authWindow) {
            var _this = this;

            return new Promise(function (resolve, reject) {

                if (_this.isValidAccessCodeCallBackUrl(callbackUrl)) {

                    var authCode = AuthService.getParameterByName('code', callbackUrl);

                    if (authCode != null) {

                        var _verifier = _this.challengePair.verifier;
                        var options = _this.getTokenPostRequest(authCode, _verifier);
                        
                        // Convert request-promise options to axios format
                        var axiosConfig = {
                            method: options.method,
                            url: options.url,
                            headers: options.headers,
                            data: JSON.parse(options.body),
                            timeout: 30000
                        };

                        // SILENCED, not tidied away. These printed the whole
                        // exchange to stdout: the PKCE code_verifier and the
                        // authorization code on the way out, then the response
                        // object -- id_token, access_token and refresh_token in
                        // full -- on the way back. `npm start` sends that to a
                        // terminal, and CI or a log file would keep it. The
                        // refresh token in particular does not expire on its
                        // own, so a pasted log is a durable credential.
                        //
                        // Left in place rather than deleted: they are the fastest
                        // way to see what Auth0 actually returned when sign-in
                        // misbehaves. Uncomment for a debugging run, and treat
                        // whatever it prints as a live credential.
                        // console.log('Making token request to:', options.url);
                        // console.log('Request data:', JSON.parse(options.body));

                        return (0, _axios2.default)(axiosConfig).then(function (response) {
                            // console.log('Auth response received:', response.data);
                            // console.log('Response keys:', Object.keys(response.data));

                            // Check if we have an id_token or access_token
                            if (response.data.id_token) {
                                // console.log('Found id_token, length:', response.data.id_token.length);
                            } else if (response.data.access_token) {
                                // NO LONGER ALIASED INTO id_token. The two are
                                // not interchangeable now: the upload endpoint
                                // POSTs its token to Auth0 /tokeninfo, which
                                // accepts ID tokens only, so copying the API
                                // access token here would turn a working
                                // upload into an unexplained 401. `openid` is
                                // in scope, so a missing id_token means the
                                // scope was dropped -- worth seeing, not
                                // papering over.
                                console.warn('No id_token in response -- uploads will fail. ' +
                                             'Check that "openid" is still in the requested scope.');
                            } else {
                                console.log('No id_token or access_token found in response');
                            }
                            
                            createmainWindow(JSON.stringify(response.data), authWindow);
                        }).catch(function (err) {
                            console.error('Auth service error:', err.message);
                            if (err.response) {
                                console.error('Response data:', err.response.data);
                                console.error('Response status:', err.response.status);
                            }
                            reject(new Error(err.message || 'Authentication failed'));
                        });
                    } else {
                        reject('Could not parse the authorization code');
                    }
                } else {
                    reject('Access code callback url not expected.');
                }
            });
        }
    }, {
        key: 'getAuthoriseUrl',
        value: function getAuthoriseUrl(challengePair) {
            // THE AUDIENCE MUST BE ON THIS URL, not merely in the config.
            //
            // This builder used to drop it, so setting config.audience did
            // nothing: Auth0 issued a token for the tenant's default audience,
            // which is an OPAQUE string rather than a JWT for our API. The API
            // cannot verify an opaque token, so every call 401'd and the picker
            // reported "Session expired" after a sign-in that had actually
            // succeeded. For an authorization_code grant the audience is bound
            // HERE, at /authorize -- adding it to the token POST is too late.
            //
            // Values are encoded because scope is now two space-separated
            // words and the audience is itself a URL.
            var params = [
                'response_type=code',
                'client_id=' + encodeURIComponent(this.config.clientId),
                'scope=' + encodeURIComponent(this.config.scope),
                'redirect_uri=' + encodeURIComponent(this.config.redirectUri),
                'code_challenge=' + encodeURIComponent(challengePair.challenge),
                'code_challenge_method=S256'
            ];
            if (this.config.audience) {
                params.push('audience=' + encodeURIComponent(this.config.audience));
            }
            return this.config.authorizeEndpoint + '?' + params.join('&');
        }
    }, {
        key: 'getTokenPostRequest',
        value: function getTokenPostRequest(authCode, verifier) {
            return {
                method: 'POST',
                url: this.config.tokenEndpoint,
                headers: { 'content-type': 'application/json' },
                body: '{"grant_type":"authorization_code","client_id": "' + this.config.clientId + '","code_verifier": "' + verifier + '","code": "' + authCode + '","redirect_uri":"' + this.config.redirectUri + '"}'
            };
        }
    }, {
        key: 'isValidAccessCodeCallBackUrl',
        value: function isValidAccessCodeCallBackUrl(callbackUrl) {
            return callbackUrl.indexOf(this.config.redirectUri) > -1;
        }
    }], [{
        key: 'getPKCEChallengePair',
        value: function getPKCEChallengePair() {
            var verifier = AuthService.base64URLEncode(_crypto2.default.randomBytes(32));
            var challenge = AuthService.base64URLEncode(AuthService.sha256(verifier));
            return { verifier: verifier, challenge: challenge };
        }
    }, {
        key: 'getParameterByName',
        value: function getParameterByName(name, url) {
            name = name.replace(/[\[\]]/g, "\\$&");
            var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
                results = regex.exec(url);
            if (!results) return null;
            if (!results[2]) return '';
            return decodeURIComponent(results[2].replace(/\+/g, " "));
        }
    }, {
        key: 'base64URLEncode',
        value: function base64URLEncode(str) {
            return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        }
    }, {
        key: 'sha256',
        value: function sha256(buffer) {
            return _crypto2.default.createHash('sha256').update(buffer).digest();
        }
    }]);

    return AuthService;
}();

exports.default = AuthService;