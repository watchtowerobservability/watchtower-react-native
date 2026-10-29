module.exports = {
  dependency: {
    platforms: {
      android: { sourceDir: './android', packageImportPath: 'import dev.watchtower.rn.WatchtowerRNPackage;', packageInstance: 'new WatchtowerRNPackage()' },
    },
  },
};
