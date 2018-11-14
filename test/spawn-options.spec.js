/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 8] */
'use strict'

const fs = require('fs')
const hat = require('hat')
const isNode = require('detect-node')
const JSIPFS = require('ipfs')
const waterfall = require('async/waterfall')
const series = require('async/series')
const chai = require('chai')
const dirtyChai = require('dirty-chai')
const IPFSFactory = require('../src')

const expect = chai.expect
chai.use(dirtyChai)

const tests = [
  { type: 'go', bits: 1024 },
  { type: 'js', bits: 512 },
  { type: 'proc', exec: JSIPFS, bits: 512 }
]

const jsVersion = require('ipfs/package.json').version
const versions = {
  js: `js-ipfs version: ${jsVersion}`,
  go: `ipfs version ${require('go-ipfs-dep/package.json').version}`,
  proc: jsVersion
}

describe('Spawn options', function () {
  this.timeout(20 * 1000)

  tests.forEach((fOpts) => describe(`${fOpts.type}`, () => {
    const VERSION_STRING = versions[fOpts.type]
    let f

    before(() => {
      f = IPFSFactory.create(fOpts)
    })

    it('f.version', function (done) {
      this.timeout(20 * 1000)

      f.version({ type: fOpts.type, exec: fOpts.exec }, (err, version) => {
        expect(err).to.not.exist()
        if (fOpts.type === 'proc') { version = version.version }
        expect(version).to.be.eql(VERSION_STRING)
        done()
      })
    })

    describe('spawn a node and attach api', () => {
      let ipfsd

      it('create init and start node', function (done) {
        this.timeout(20 * 1000)

        f.spawn({ initOptions: { bits: fOpts.bits } },
          (err, _ipfsd) => {
            expect(err).to.not.exist()
            expect(_ipfsd).to.exist()
            expect(_ipfsd.api).to.exist()
            expect(_ipfsd.api.id).to.exist()

            ipfsd = _ipfsd
            done()
          })
      })

      it('ipfsd.stop', function (done) {
        this.timeout(20 * 1000)

        ipfsd.stop(done)
      })
    })

    // TODO re-enable when jenkins runs tests in isolation
    describe.skip('spawn with default swarm addrs', () => {
      const addrs = {
        go: [
          '/ip4/0.0.0.0/tcp/4001',
          '/ip6/::/tcp/4001'
        ],
        js: [
          '/ip4/0.0.0.0/tcp/4002',
          '/ip4/127.0.0.1/tcp/4003/ws'
        ],
        proc: [
          '/ip4/0.0.0.0/tcp/4002',
          '/ip4/127.0.0.1/tcp/4003/ws'
        ]
      }

      it('swarm contains default addrs', function (done) {
        this.timeout(20 * 1000)

        if (!isNode && fOpts.type === 'proc') {
          this.skip()
        }

        f.spawn({
          defaultAddrs: true,
          initOptions: {
            bits: fOpts.bits
          }
        }, (err, ipfsd) => {
          expect(err).to.not.exist()
          ipfsd.getConfig('Addresses.Swarm', (err, config) => {
            expect(err).to.not.exist()
            if (fOpts.type !== 'proc') {
              config = JSON.parse(config)
            }

            expect(config).to.deep.equal(addrs[fOpts.type])
            ipfsd.stop(done)
          })
        })
      })
    })

    describe('custom config options', () => {
      it('custom config', function (done) {
        this.timeout(50 * 1000)

        const addr = '/ip4/127.0.0.1/tcp/5678'
        const swarmAddr1 = '/ip4/127.0.0.1/tcp/35666'
        const config = {
          Addresses: {
            Swarm: [
              swarmAddr1
            ],
            API: addr
          },
          Bootstrap: ['/dns4/wss0.bootstrap.libp2p.io/tcp/443/wss/ipfs/QmZMxNdpMkewiVZLMRxaNxUeZpDUb34pWjZ1kZvsd16Zic']
        }

        const options = { config: config, initOptions: { bits: fOpts.bits } }

        waterfall([
          (cb) => f.spawn(options, cb),
          (ipfsd, cb) => ipfsd.getConfig('Addresses.API', (err, config) => {
            expect(err).to.not.exist()
            expect(config).to.eql(addr)
            cb(null, ipfsd)
          }),
          (ipfsd, cb) => ipfsd.getConfig('Addresses.Swarm', (err, config) => {
            expect(err).to.not.exist()

            // TODO why would this not be always the same type?
            if (typeof config === 'string') {
              config = JSON.parse(config)
            }
            expect(config).to.eql([swarmAddr1])
            // expect(config).to.include(swarmAddr1)
            cb(null, ipfsd)
          }),
          (ipfsd, cb) => ipfsd.getConfig('Bootstrap', (err, bootstrapConfig) => {
            expect(err).to.not.exist()
            if (typeof bootstrapConfig === 'string') {
              bootstrapConfig = JSON.parse(bootstrapConfig)
            }
            expect(bootstrapConfig).to.deep.equal(config.Bootstrap)
            cb(null, ipfsd)
          })
        ], (err, ipfsd) => {
          expect(err).to.not.exist()
          ipfsd.stop(done)
        })
      })
    })

    describe('custom repo path', () => {
      // TODO why wouldn't this work from the browser if we use the
      // remote endpoint?
      if (!isNode) { return }

      let repoPath

      before((done) => {
        f.tmpDir(fOpts.type, (err, tmpDir) => {
          expect(err).to.not.exist()
          repoPath = tmpDir
          done()
        })
      })

      it('allows passing custom repo path to spawn', function (done) {
        const options = {
          disposable: false,
          init: true,
          start: true,
          repoPath: repoPath,
          initOptions: { bits: fOpts.bits }
        }

        f.spawn(options, (err, ipfsd) => {
          expect(err).to.not.exist()
          if (isNode) {
            // We can only check if it really got created when run in Node.js
            expect(fs.existsSync(repoPath)).to.be.ok()
          }
          ipfsd.stop(() => ipfsd.cleanup(done))
        })
      })
    })

    describe('f.spawn with args', () => {
      if (!isNode && fOpts.type !== 'proc') { return }

      let ipfsd

      it('spawn with pubsub', function (done) {
        this.timeout(20 * 1000)

        const options = {
          args: ['--enable-pubsub-experiment'],
          initOptions: { bits: fOpts.bits }
        }

        f.spawn(options, (err, _ipfsd) => {
          expect(err).to.not.exist()
          ipfsd = _ipfsd
          done()
        })
      })

      it('check that pubsub was enabled', (done) => {
        const topic = `test-topic-${hat()}`
        const data = Buffer.from('hey there')

        const handler = (msg) => {
          expect(msg.data).to.eql(data)
          expect(msg).to.have.property('seqno')
          expect(Buffer.isBuffer(msg.seqno)).to.eql(true)
          expect(msg).to.have.property('topicIDs').eql([topic])
          done()
        }

        ipfsd.api.pubsub.subscribe(topic, handler, (err) => {
          expect(err).to.not.exist()
          ipfsd.api.pubsub.publish(topic, data)
        })
      })

      it('ipfsd.stop', function (done) {
        this.timeout(20 * 1000)
        ipfsd.stop(done)
      })
    })

    describe('change config while running', () => {
      let ipfsd

      before(function (done) {
        this.timeout(20 * 1000)
        f.spawn({ initOptions: { bits: fOpts.bits } },
          (err, _ipfsd) => {
            expect(err).to.not.exist()
            ipfsd = _ipfsd
            done()
          })
      })

      after(function (done) {
        this.timeout(20 * 1000)
        ipfsd.stop(done)
      })

      it('ipfsd.getConfig', (done) => {
        ipfsd.getConfig((err, config) => {
          expect(err).to.not.exist()
          expect(config).to.exist()
          done()
        })
      })

      it('ipfsd.getConfig of specific value', (done) => {
        ipfsd.getConfig('Bootstrap', (err, config) => {
          expect(err).to.not.exist()
          expect(config).to.exist()
          done()
        })
      })

      it('Should set a config value', function (done) {
        this.timeout(20 * 1000)

        series([
          (cb) => ipfsd.setConfig('Bootstrap', 'null', cb),
          (cb) => ipfsd.getConfig('Bootstrap', cb)
        ], (err, res) => {
          expect(err).to.not.exist()
          expect(res[1]).to.eql('null')
          done()
        })
      })

      it('error on invalid config', function (done) {
        // TODO: fix this - js doesn't fail on invalid config
        if (fOpts.type !== 'go') { return this.skip() }

        ipfsd.setConfig('Bootstrap', 'true', (err) => {
          expect(err.message)
            .to.match(/(?:Error: )?failed to set config value/mgi)
          done()
        })
      })
    })
  }))
})
